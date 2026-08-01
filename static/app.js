const state = {
  token: sessionStorage.getItem("slr-permit-token") || "",
  user: null,
  config: { departments: [], divisions: [], designations: [] },
  page: "dashboard",
  approvalsFilter: "all",
  permitsDivisionFilter: "all",
  usersDivisionFilter: "all",
};

const ICONS = {
  eye: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
  eyeOff: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`,
};

const labels = {
  authorityChecked: "Issuing authority checked all precautions regarding Electrical, Mechanical & Civil isolations",
  topFiringDone: "Top firing done",
  systemIsolated: "System isolated",
  steamNitrogenPurge: "Steam / nitrogen purging done",
  coBelow50: "CO level in work area below 50 ppm",
  mechanicalEquipmentIsolation: "Equipment / pipeline identified",
  mechanicalValvesClosed: "Valves closed and tagged",
  mechanicalDepressurised: "Equipment depressurised",
  mechanicalPressureRelievedCooled: "Pressure released, flushed and cooled",
  mechanicalPlcDeselected: "PLC deselected",
  mechanicalHazardousMaterialDrained: "Hazardous material drained",
  utilityServices: "Service identified (Steam / Air / Water / Gas / Other)",
  utilityValvesTagged: "Utility valve closed and tagged",
  utilityDepressurised: "Utility line depressurised",
  electricalDrivePanel: "Drive / panel identified",
  electricalFuseRemoved: "Fuse removed",
  electricalIsolatorLocked: "Isolator put off & Lock Out / Tag Out (LOTO)",
  electricalTagOut: "Electrical tag-out applied",
  tagsBoards: "Safety tags / boards displayed",
  cordoned: "Area of work cordoned off",
  ppe: "Required PPE available",
  hotEquipment: "Hot-work equipment in good condition",
  hotAreaClear: "Area clear of combustible material",
  hotMasking: "Combustibles masked / shielded",
  hotOpenings: "Wall and floor openings covered",
  hotExtinguisher: "Fire extinguisher available nearby",
  hotPurging: "Flammable vapours purged from enclosed equipment",
  confinedAirTest: "Air tested and safe for work",
  oxygen: "Oxygen content 19.5–23.5%",
  openings: "Two openings available for cross ventilation",
  entryPermit: "Safe-entry permit displayed at entrance",
  standby: "Standby person and rescue arrangement available",
  trained: "Trained and skilled workers deployed",
  scaffolding: "Proper scaffold provided for working",
  safetyBelt: "Safety belts secured to firm anchor point",
  ladders: "Ladders checked and in good condition",
  accessToolhold: "Secure access and toolhold at elevated place",
  excavationManual: "Manual / mechanised excavation planned",
  cables: "Underground cables checked",
  pipes: "Underground pipes checked",
  allPersonnelWithdrawn: "All people and tools withdrawn",
  guardsReplaced: "Guards replaced and equipment boxed up",
  looseMaterialsRemoved: "Loose material / scrap / waste removed",
  trialTaken: "Equipment trial taken",
  servicesRestored: "All services restored",
};

const $ = (selector, within = document) => within.querySelector(selector);
const $$ = (selector, within = document) => [...within.querySelectorAll(selector)];

let deferredInstallPrompt = null;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? escapeHtml(value) : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function titleCase(value) { return String(value || "").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()); }
function initials(name = "") { return name.split(/\s+/).map(word => word[0]).join("").slice(0, 2).toUpperCase(); }

let toastTimer;
function toast(message, isError = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 4200);
}

function togglePasswordVisibility(event) {
  const button = event.currentTarget;
  const wrapper = button.closest('.password-wrapper');
  if (!wrapper) return;
  const input = $('input', wrapper);
  if (input.type === 'password') {
    input.type = 'text';
    button.innerHTML = ICONS.eyeOff;
    button.setAttribute('aria-label', 'Hide password');
  } else {
    input.type = 'password';
    button.innerHTML = ICONS.eye;
    button.setAttribute('aria-label', 'Show password');
  }
}

const alertChannelName = "slr-permit-notifications";
let alertChannel = null;
let alertTimer = null;
let alertAudioContext = null;
let alertIntervalId = null;

function stopAlertSound() {
  if (alertIntervalId) clearInterval(alertIntervalId);
  alertIntervalId = null;
}

function playAlertTone() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  if (!alertAudioContext) alertAudioContext = new AudioCtor();
  if (alertAudioContext.state === "suspended") alertAudioContext.resume().catch(() => {});
  const oscillator = alertAudioContext.createOscillator();
  const gain = alertAudioContext.createGain();
  oscillator.type = "sine"; // Use a softer sine wave
  oscillator.frequency.value = 660; // A slightly lower, less jarring pitch
  gain.gain.value = 0.04;
  oscillator.connect(gain);
  gain.connect(alertAudioContext.destination);
  oscillator.start();
  oscillator.stop(alertAudioContext.currentTime + 0.18);
}

function startAlertSound() {
  stopAlertSound();
  playAlertTone();
  alertIntervalId = setInterval(playAlertTone, 1100);
}

function showGlobalAlert(message) {
  const alertBox = $("#global-alert");
  const alertText = $("#global-alert-text", alertBox);
  alertText.textContent = message;
  alertBox.classList.remove("hidden");
  alertBox.classList.add("show");
}

function hideGlobalAlert() {
  const alertBox = $("#global-alert");
  alertBox.classList.add("hidden");
  alertBox.classList.remove("show");
}

function acknowledgeGlobalAlert() {
  stopAlertSound();
  hideGlobalAlert();
}

function handleGlobalAlert(payload) {
  if (!payload || payload.type !== "permit-alert") return;
  showGlobalAlert(payload.message);
  startAlertSound();
}

function initGlobalAlerts() {
  if (typeof window === "undefined") return;
  const alertBox = $("#global-alert");
  $("#acknowledge-alert")?.addEventListener("click", acknowledgeGlobalAlert);
  if (typeof BroadcastChannel !== "undefined") {
    alertChannel = new BroadcastChannel(alertChannelName);
    alertChannel.addEventListener("message", event => handleGlobalAlert(event.data));
  }
  window.addEventListener("storage", event => {
    if (event.key !== alertChannelName || !event.newValue) return;
    try { handleGlobalAlert(JSON.parse(event.newValue)); } catch {}
  });
  alertBox?.addEventListener("click", event => {
    if (event.target === alertBox) acknowledgeGlobalAlert();
  });
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });

  const responseText = await response.text();
  let result = {};
  try {
    if (responseText) {
      result = JSON.parse(responseText);
    }
  } catch (e) {
    // The response was not valid JSON. We can't get an error message from it.
    // We'll rely on the status code for the error message.
  }

  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/login") {
      showAuth();
    }
    throw new Error(result.error || `Request failed with status ${response.status}.`);
  }
  return result;
}

function optionHtml(items, selected, placeholder = "Select one") {
  return `<option value="">${placeholder}</option>${items.map(item => `<option value="${escapeHtml(item)}" ${item === selected ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}`;
}

function checkbox(key, text = labels[key]) {
  return `<label class="check-item"><input type="checkbox" data-check="${key}" /> <span>${escapeHtml(text)}</span></label>`;
}

function checkedSummary(data) {
  const entries = Object.entries(data || {}).filter(([key, value]) => value === true && labels[key]);
  return entries.length ? `<div class="checked-list">${entries.map(([key]) => `<span>✓ ${escapeHtml(labels[key])}</span>`).join("")}</div>` : `<p class="small-text">No items recorded.</p>`;
}

function collectChecks(form) {
  const output = {};
  $$('[data-check]', form).forEach(element => { output[element.dataset.check] = element.checked; });
  const coPpm = form.elements.coPpm?.value.trim();
  if (coPpm) output.coPpm = Number(coPpm);
  return output;
}

function statusBadge(status) { return `<span class="status ${escapeHtml(status)}">${escapeHtml(titleCase(status))}</span>`; }

function userStatusBadge(status) {
  const statusMap = {
    approved: { class: "issued", text: "Approved" },
    pending: { class: "pending_approval", text: "Pending" },
    rejected: { class: "rejected", text: "Rejected" },
    deactivated: { class: "closed", text: "Deactivated" },
  };
  const s = statusMap[status] || { class: "closed", text: titleCase(status) };
  return `<span class="status ${escapeHtml(s.class)}">${escapeHtml(s.text)}</span>`;
}

function permitTable(permits, options = {}) {
  if (!permits.length) return $("#empty-state-template").content.cloneNode(true).firstElementChild.outerHTML;
  return `<section class="card table-card"><div class="table-scroll"><table><thead><tr><th>Permit</th><th>Work / location</th><th>Division</th><th>Requestor</th><th>Validity</th><th>Status</th></tr></thead><tbody>${permits.map(permit => `
    <tr class="clickable" data-permit-id="${permit.id}">
      <td><span class="permit-id">${escapeHtml(permit.permitNo)}</span><span class="small-text">${formatDate(permit.requestedAt)}</span></td>
      <td><strong>${escapeHtml(permit.workDescription.length > 54 ? `${permit.workDescription.slice(0, 54)}…` : permit.workDescription)}</strong><br><span class="small-text">${escapeHtml(permit.area)}</span></td>
      <td>${escapeHtml(permit.division)}<br><span class="small-text">${escapeHtml(permit.department)}</span></td>
      <td>${escapeHtml(permit.requesterName)}</td>
      <td class="small-text">To ${formatDate(permit.validUntil)}</td>
      <td>${statusBadge(permit.status)}</td>
    </tr>`).join("")}</tbody></table></div></section>`;
}

function attachPermitRows(container = document) {
  $$("[data-permit-id]", container).forEach(row => row.addEventListener("click", () => openPermit(row.dataset.permitId)));
}

function isAdmin() { return state.user?.role === "admin"; }

async function renderDashboard() {
  const data = await api("/api/dashboard");
  const counts = data.counts || {};
  const pendingCount = (counts.pending_department_approval || 0) + (counts.pending_approval || 0);

  let recentPermitsHtml;
  if (isAdmin() && data.recent.length > 0) {
    const permitsByDivision = data.recent.reduce((acc, permit) => {
        (acc[permit.division] = acc[permit.division] || []).push(permit);
        return acc;
    }, {});
    const divisions = Object.keys(permitsByDivision).sort();

    const divisionPermitsHtml = divisions.map(division => {
        return `<div class="division-group"><h3>${escapeHtml(division)}</h3>${permitTable(permitsByDivision[division])}</div>`;
    }).join('');

    recentPermitsHtml = `<section><div class="section-title"><h2>Recent permits by Division</h2><button class="link-button" id="view-all-permits" type="button">View all →</button></div>${divisionPermitsHtml}</section>`;
  } else {
    recentPermitsHtml = `<section><div class="section-title"><h2>Recent permits</h2><button class="link-button" id="view-all-permits" type="button">View all →</button></div>${permitTable(data.recent)}</section>`;
  }

  $("#page-content").innerHTML = `
    <section class="card dashboard-actions">
      <div><h2>${isAdmin() ? "You control access and permit approval" : "Every safe job starts with a controlled permit"}</h2><p>${isAdmin() ? "Review pending access requests and permits before any work starts." : "Submit the work details and safety checks. The administrator must issue the permit before work begins."}</p></div>
      <button class="button primary" type="button" id="dashboard-new-permit">Create permit</button>
    </section>
    <section class="stats" aria-label="Permit status summary">
      <div class="card stat"><strong>${pendingCount}</strong><span>Awaiting approval</span></div>
      <div class="card stat"><strong>${counts.issued || 0}</strong><span>Active permits</span></div>
      <div class="card stat"><strong>${counts.job_completed || 0}</strong><span>Ready to close</span></div>
      <div class="card stat"><strong>${counts.closed || 0}</strong><span>Closed permits</span></div>
    </section>
    ${recentPermitsHtml}`;
  $("#dashboard-new-permit").addEventListener("click", () => go("new-permit"));
  $("#view-all-permits").addEventListener("click", () => go("permits"));
  attachPermitRows();
  updatePendingBadge(data.pendingUsers);
}

function checklistGroup(title, description, keys) {
  return `<div class="type-card"><strong>${escapeHtml(title)}</strong>${description ? `<p class="small-text">${escapeHtml(description)}</p>` : ""}<div class="check-grid">${keys.map(key => checkbox(key)).join("")}</div></div>`;
}

async function renderNewPermit() {
  const now = new Date();
  const validFromDefault = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  now.setHours(now.getHours() + 8); // Default to 8 hours validity
  const validUntilDefault = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);

  const isCmdUser = state.user.division === 'CMD';
  const otherDivisions = state.config.divisions.filter(d => d !== 'CMD');

  const divisionHtml = isCmdUser
    ? `<label>Target Work Division<select name="targetDivision" required>${optionHtml(otherDivisions, '', "Select target division")}</select></label>`
    : `<label>Division (from your profile)<input type="text" value="${escapeHtml(state.user.division)}" readonly disabled /></label>`;

  const isolationHtml = isCmdUser
    ? `
      <div class="check-grid three">
        <label class="check-item"><input type="checkbox" name="requiredIsolations" value="Operation" checked /> <span>Operation Isolation (Target Division)</span></label>
        <label class="check-item"><input type="checkbox" name="requiredIsolations" value="Mechanical" /> <span>Mechanical Isolation (CMD)</span></label>
        <label class="check-item"><input type="checkbox" name="requiredIsolations" value="Electrical" /> <span>Electrical Isolation (CMD)</span></label>
      </div>`
    : `
      <div class="check-grid four">
        <label class="check-item"><input type="checkbox" name="requiredIsolations" value="Operation" /> <span>Operation isolation</span></label>
        <label class="check-item"><input type="checkbox" name="requiredIsolations" value="Mechanical" /> <span>Mechanical isolation</span></label>
        <label class="check-item"><input type="checkbox" name="requiredIsolations" value="Utility" /> <span>Utility isolation</span></label>
        <label class="check-item"><input type="checkbox" name="requiredIsolations" value="Electrical/Instrumentation" /> <span>Electrical / Instrumentation isolation</span></label>
      </div>`;

  $("#page-content").innerHTML = `
    <form id="permit-form" class="card form-card" novalidate>
      <div class="form-intro"><h2>New safe work permit</h2><p>Complete the activity-specific checks that are applicable. This request remains inactive until the administrator reviews and issues it.</p></div>
      
      <section class="form-section">
        <h3>1. Work details</h3><p>These are the main details from the top of the paper permit.</p>
        <div class="form-grid three">
          ${divisionHtml}
          <label class="full">Details of work to be carried out<textarea name="workDescription" required maxlength="2000" placeholder="Describe the work, method, and equipment involved."></textarea></label>
          <label>Department<select name="department" required>${optionHtml(state.config.departments, state.user.department, "Select department")}</select></label>
          <label>Mobile number for contact<input name="contactNumber" type="tel" required pattern="\\d{10}" maxlength="10" placeholder="Enter 10-digit mobile number" title="Enter a 10-digit mobile number." value="${escapeHtml(state.user.mobileNumber || '')}" /></label>
          <label>Area / location<input name="area" required maxlength="200" placeholder="Example: MBF 1 - Cast house" /></label>
          <label>Equipment / asset<input name="equipment" maxlength="200" placeholder="Example: Main blower" /></label>
          <label>Valid from<input name="validFrom" type="datetime-local" required value="${validFromDefault}" /></label>
          <label>Valid until<input name="validUntil" type="datetime-local" required value="${validUntilDefault}" /></label>
        </div>
      </section>

      <section class="form-section"><h3>2. Isolation required</h3><p>Select the departments that need to perform isolation for this job. This will determine the approval workflow.</p>${isolationHtml}</section>

      <section class="form-section">
        <h3>3. General safety precautions</h3><p>Select the permit activity, then record the specific checks completed. If any high-risk activity is selected, Safety & Fire approval will be required.</p>
        <div class="check-grid" style="margin-top:14px">${["tagsBoards", "cordoned", "ppe"].map(key => checkbox(key)).join("")}</div>
        <div class="check-grid" style="margin-top:14px">
          ${checklistGroup("Hot work", "Fire and combustible-material controls", ["hotEquipment", "hotAreaClear", "hotMasking", "hotOpenings", "hotExtinguisher", "hotPurging"])}
          ${checklistGroup("Confined space", "Atmosphere, entry and rescue controls", ["confinedAirTest", "oxygen", "openings", "entryPermit", "standby", "trained"])}
          ${checklistGroup("Working at height", "Scaffolding, fall protection and access", ["scaffolding", "safetyBelt", "ladders", "accessToolhold"])}
          ${checklistGroup("Excavation", "Excavation method and underground services", ["excavationManual", "cables", "pipes"])}
        </div>
      </section>

      <p class="notice">By submitting, you confirm these details are accurate. The job must not begin until the permit is fully approved and issued.</p>
      <div class="submit-row"><button class="button secondary" type="button" id="cancel-permit">Cancel</button><button class="button primary" type="submit">Send for approval</button></div>
    </form>`;
  $("#cancel-permit").addEventListener("click", () => go("dashboard"));
  $("#permit-form").addEventListener("submit", submitPermit);
}

async function submitPermit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const formData = new FormData(form);
  const validFrom = new Date(formData.get("validFrom"));
  const validUntil = new Date(formData.get("validUntil"));
  if (validUntil <= validFrom) return toast("Valid-until time must be later than the start time.", true);

  const precautions = collectChecks(form);
  const requiredIsolations = formData.getAll("requiredIsolations");

  const department = formData.get("department") || "";
  let payload = {
    workDescription: formData.get("workDescription"),
    department,
    area: formData.get("area"),
    equipment: formData.get("equipment"),
    contactNumber: String(formData.get("contactNumber") || "").trim(),
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    requiredIsolations: requiredIsolations,
    precautions: precautions,
  };

  if (state.user.division === 'CMD') {
    payload.targetDivision = formData.get("targetDivision");
  }

  const submit = $("button[type=submit]", form);
  submit.disabled = true;
  submit.textContent = "Submitting...";
  try {
    const result = await api("/api/permits", { method: "POST", body: JSON.stringify(payload) });
    toast(result.message || `${result.permitNo} sent for approval.`);
    form.reset();
    go("permits");
  } catch (error) { 
    toast(error.message, true); 
    submit.disabled = false;
    submit.textContent = "Send for approval";
  }
}

async function renderPermits() {
  const data = await api("/api/permits");
  const allPermits = data.permits || [];

  if (isAdmin()) {
    const divisions = ['All', ...[...new Set(allPermits.map(p => p.division))].sort()];
    
    const divisionTabsHtml = `
      <div class="filter-group" id="division-filter-group">
        ${divisions.map(division => `
          <button class="filter-button" data-division-filter="${escapeHtml(division)}">${escapeHtml(division)}</button>
        `).join('')}
      </div>`;

    $("#page-content").innerHTML = `
      <section>
        <div class="section-title">
          <div>
            <h2>All permits</h2>
            <p class="small-text">Select a division to filter the permits below, or create a new one.</p>
          </div>
          <button id="permit-add" class="button primary" type="button">New permit</button>
        </div>
        ${divisionTabsHtml}
        <div id="permit-list-container"></div>
      </section>`;

    const permitListContainer = $("#permit-list-container");

    function applyDivisionFilter(filter) {
      state.permitsDivisionFilter = filter;
      $$("#division-filter-group .filter-button").forEach(btn => btn.classList.toggle("active", btn.dataset.divisionFilter === filter));
      
      const filteredPermits = filter === 'All' 
        ? allPermits 
        : allPermits.filter(p => p.division === filter);
        
      permitListContainer.innerHTML = permitTable(filteredPermits);
      attachPermitRows(permitListContainer);
    }

    $$("#division-filter-group .filter-button").forEach(button => {
      button.addEventListener("click", () => applyDivisionFilter(button.dataset.divisionFilter));
    });

    if (!divisions.includes(state.permitsDivisionFilter)) {
        state.permitsDivisionFilter = 'All';
    }
    applyDivisionFilter(state.permitsDivisionFilter);
  } else {
    $("#page-content").innerHTML = `<section><div class="section-title"><div><h2>Permits for ${escapeHtml(state.user.division)}</h2><p class="small-text">Select a permit to view its safety checklist, workflow, and audit trail.</p></div><button id="permit-add" class="button primary" type="button">New permit</button></div>${permitTable(allPermits)}</section>`;
    attachPermitRows();
  }
  $("#permit-add").addEventListener("click", () => go("new-permit"));
}

function detailItem(label, value) { return `<div class="detail-box"><b>${escapeHtml(label)}</b><span>${escapeHtml(value || "—")}</span></div>`; }

function normalisationChecks() {
  return ["allPersonnelWithdrawn", "guardsReplaced", "looseMaterialsRemoved", "trialTaken", "servicesRestored"].map(key => checkbox(key)).join("");
}

async function openPermit(permitId) {
  try {
    const data = await api(`/api/permits/${permitId}`);
    const p = data.permit;
    const approvals = data.approvals || [];
    const jobTypes = (p.jobTypes || []).map(type => titleCase(type));
    const dialogContent = `
      <article class="permit-detail"><header class="detail-head"><p class="eyebrow">DIGITAL SAFE WORK PERMIT</p><h2>${escapeHtml(p.permitNo)} ${statusBadge(p.status)}</h2><p class="detail-meta">Submitted by ${escapeHtml(p.requesterName)} on ${formatDate(p.requestedAt)}</p></header>
      <section class="detail-grid">${detailItem("Division", p.division)}${detailItem("Department", p.department)}${detailItem("Area / location", p.area)}${detailItem("Equipment", p.equipment)} ${detailItem("For any further information", `Call ${p.requesterName} at ${p.contactNumber || "—"}`)}</section>
      <section class="detail-section"><h3>Work to be carried out</h3><p>${escapeHtml(p.workDescription).replaceAll("\n", "<br>")}</p></section>
      
      <section class="detail-section"><h3>General safety precautions</h3>${checkedSummary(p.precautions)}</section>
      
      <section class="detail-section"><h3>Departmental Approvals</h3>${renderApprovalsList(approvals)}</section>
      
      ${p.issuerNote ? `<section class="detail-section"><h3>Administrator note</h3><p>${escapeHtml(p.issuerNote)}</p></section>` : ""}
      ${p.status === "job_completed" || p.status === "closed" ? `<section class="detail-section"><h3>Normalisation after job completion</h3>${checkedSummary(p.normalisation)}</section>` : ""}
      <section class="detail-section"><h3>Audit trail</h3><ul class="audit-list">${data.audit.map(entry => `<li><strong>${escapeHtml(entry.action)}</strong><small>${escapeHtml(entry.actor)} · ${formatDate(entry.createdAt)}</small>${entry.detail?.note ? `<small>Note: ${escapeHtml(entry.detail.note)}</small>` : ""}</li>`).join("")}</ul></section>
      <div class="dialog-actions">
        <button class="button secondary" type="button" id="print-permit">Print / save as PDF</button>
        ${isAdmin() && (p.status === 'pending_approval' || p.status === 'pending_department_approval') ? '<span class="status admin-view">Admin View Only</span>' : ''}
        ${(state.user?.role === 'issuer' || state.user?.role === 'safety') && p.status === "pending_approval" ? `<button class="button primary" type="button" id="review-permit">Review permit</button>` : ""}
        ${p.status === 'pending_department_approval' && canUserApprove(approvals) ? `<button class="button primary" type="button" id="dept-approve-permit">Review & Approve</button>` : ""}
        ${isAdmin() && p.status === "job_completed" ? `<button class="button primary" type="button" id="close-permit">Close permit</button>` : ""}
        ${!isAdmin() && p.status === "issued" && p.requesterId === state.user.id ? `<button class="button primary" type="button" id="finish-job">Record job completion</button>` : ""}
        ${isAdmin() ? `<button class="button danger" type="button" id="delete-permit">Delete</button>` : ""}
      </div>
      <div id="permit-action-panel"></div>
      </article>`;
    $("#dialog-content").innerHTML = dialogContent;
    const dialog = $("#permit-dialog");
    dialog.showModal();
    $("#print-permit").addEventListener("click", () => window.print());
    $("#dept-approve-permit")?.addEventListener("click", () => showDepartmentApprovalPanel(p.id));
    $("#review-permit")?.addEventListener("click", () => showReviewPanel(p.id));
    $("#close-permit")?.addEventListener("click", () => closePermit(p.id));
    $("#finish-job")?.addEventListener("click", () => showCompletionPanel(p.id));
    $("#delete-permit")?.addEventListener("click", () => deletePermit(p.id));
  } catch (error) { toast(error.message, true); }
}

function renderApprovalDetails(approval) {
  const details = approval.detail || {};
  if (Object.keys(details).length === 0) return '';

  const checkedItems = Object.entries(details)
    .filter(([key, value]) => value === true && labels[key])
    .map(([key]) => `<span>✓ ${escapeHtml(labels[key])}</span>`)
    .join("");

  const otherDetails = [];
  if (details.coPpm != null) {
    otherDetails.push(`<p class="small-text detail-item">Recorded CO reading: ${escapeHtml(details.coPpm)} ppm</p>`);
  }
  if (details.safetyNote) {
    otherDetails.push(`<p class="small-text detail-item"><strong>Additional Precautions:</strong> ${escapeHtml(details.safetyNote)}</p>`);
  }

  return `<div class="approval-details">${checkedItems ? `<div class="checked-list">${checkedItems}</div>` : ''}${otherDetails.join('')}</div>`;
}

function renderApprovalsList(approvals) {
  if (!approvals.length) return `<p class="small-text">No departmental approvals are required for this permit type.</p>`;

  const pendingApprovals = approvals.filter(a => a.status === 'pending');
  const currentStage = pendingApprovals.length > 0 ? Math.min(...pendingApprovals.map(a => a.stage)) : Infinity;

  return `<div class="approvals-grid">${approvals.map(appr => {
    let statusContent;
    let statusClass = appr.status;

    switch (appr.status) {
      case 'approved':
        statusContent = `
          <span class="small-text">✓ Approved by ${escapeHtml(appr.approverName || 'N/A')}</span>
          <span class="small-text">(${escapeHtml(appr.approverMobile || 'N/A')}) at ${formatDate(appr.approvedAt)}</span>
        `;
        break;
      case 'rejected':
        statusContent = `
          <span class="small-text">✗ Rejected by ${escapeHtml(appr.approverName || 'N/A')}</span>
          <span class="small-text">at ${formatDate(appr.approvedAt)}</span>
        `;
        break;
      case 'pending':
        if (appr.stage > currentStage) {
          statusClass = 'waiting';
          statusContent = `<span class="small-text">Pending Stage ${appr.stage - 1} Approval</span>`;
        } else {
          statusContent = `<span class="small-text">Awaiting approval</span>`;
        }
        break;
      default:
        statusContent = `<span class="small-text">${escapeHtml(titleCase(appr.status))}</span>`;
    }

    return `
      <div class="approval-item status-${statusClass}">
        <strong>Stage ${appr.stage}${appr.isFinal ? ' (Final)' : ''}: ${escapeHtml(appr.department)}</strong>
        ${statusContent}
        ${appr.status === 'approved' ? renderApprovalDetails(appr) : ''}
      </div>`;
  }).join("")}</div>`;
}

function canUserApprove(approvals) {
  if (!state.user || state.user.role === "admin") return false;
  const pendingApprovals = approvals.filter(a => a.status === 'pending');
  if (!pendingApprovals.length) return false;

  const currentStage = Math.min(...pendingApprovals.map(a => a.stage));

  return pendingApprovals.some(appr =>
    appr.department === state.user.department && appr.stage === currentStage
  );
}

function showDepartmentApprovalPanel(permitId) {
  const dept = state.user.department;
  let checklistHtml = '';

  switch (dept) {
    case 'Operation':
      checklistHtml = `
        <div class="check-grid">${["authorityChecked", "topFiringDone", "systemIsolated", "steamNitrogenPurge", "coBelow50"].map(key => checkbox(key)).join("")}</div>
        <div class="form-grid" style="margin-top: 14px"><label>CO reading (ppm)<input name="coPpm" type="number" min="0" max="10000" placeholder="Enter measured CO value" /></label></div>`;
      break;
    case 'Mechanical':
      checklistHtml = `<div class="check-grid">${["mechanicalEquipmentIsolation", "mechanicalValvesClosed", "mechanicalDepressurised", "mechanicalPressureRelievedCooled", "mechanicalPlcDeselected", "mechanicalHazardousMaterialDrained"].map(key => checkbox(key)).join("")}</div>`;
      break;
    case 'Utility':
      checklistHtml = `<div class="check-grid">${["utilityServices", "utilityValvesTagged", "utilityDepressurised"].map(key => checkbox(key)).join("")}</div>`;
      break;
    case 'Electrical/Instrumentation':
      checklistHtml = `<div class="check-grid">${["electricalDrivePanel", "electricalFuseRemoved", "electricalIsolatorLocked"].map(key => checkbox(key)).join("")}</div>`;
      break;
    case 'Safety & Fire':
      checklistHtml = `<label>Additional precautions to be taken<textarea name="safetyNote" placeholder="Enter any additional precautions, or 'N/A' if none."></textarea></label>`;
      break;
  }

  $("#permit-action-panel").innerHTML = `
    <form class="completion-form" id="dept-approval-form">
      <h3>Department Approval</h3>
      <p class="small-text">As a representative of the ${escapeHtml(state.user.department)} department, you are signing off on this permit. Your details will be recorded.</p>
      ${checklistHtml ? `<h4>Precautions (Optional)</h4>${checklistHtml}` : ''}
      <label>Your Name<input name="approverName" type="text" required value="${escapeHtml(state.user.fullName)}"></label>
      <label>Your Mobile Number<input name="approverMobile" type="tel" required pattern="\\d{10}" maxlength="10" value="${escapeHtml(state.user.mobileNumber)}"></label>
      <div class="dialog-actions">
        <button class="button danger" type="button" id="dept-reject-btn">Reject Permit</button>
        <button class="button primary" type="submit" id="dept-approve-btn">Approve Permit</button>
      </div>
    </form>`;
  
  const form = $("#dept-approval-form");
  form.addEventListener("submit", (e) => { e.preventDefault(); submitDepartmentApproval(permitId, 'approved'); });
  $("#dept-reject-btn").addEventListener("click", () => submitDepartmentApproval(permitId, 'rejected'));
}

async function submitDepartmentApproval(permitId, decision) {
  const form = $("#dept-approval-form");
  if (decision === 'approved' && !form.reportValidity()) return;

  const precautions = collectChecks(form);
  const safetyNote = form.elements.safetyNote?.value.trim();
  if (safetyNote) precautions.safetyNote = safetyNote;

  const payload = {
    decision,
    approverName: form.elements.approverName.value,
    approverMobile: form.elements.approverMobile.value,
    precautions
  };

  if (decision === 'rejected' && !window.confirm("Are you sure you want to reject this permit? This will stop the workflow.")) return;

  try {
    const result = await api(`/api/permits/${permitId}/department-approve`, { method: "POST", body: JSON.stringify(payload) });
    toast(result.message);
    $("#permit-dialog").close();
    await refreshCurrentPage();
  } catch (error) { toast(error.message, true); }
}

function showReviewPanel(permitId) {
  $("#permit-action-panel").innerHTML = `<section class="completion-form"><h3>Administrator permit decision</h3><label>Decision note (required when rejecting)<textarea id="decision-note" class="approval-note" maxlength="1000" placeholder="Record limitations, conditions, or reason for rejection."></textarea></label><div class="dialog-actions"><button class="button danger" id="reject-permit" type="button">Reject permit</button><button class="button primary" id="issue-permit" type="button">Issue permit</button></div></section>`;
  $("#issue-permit").addEventListener("click", () => decidePermit(permitId, "approve"));
  $("#reject-permit").addEventListener("click", () => decidePermit(permitId, "reject"));
}

async function decidePermit(permitId, decision) {
  const note = $("#decision-note").value.trim();
  if (decision === "reject" && !note) return toast("Add the reason for rejection before continuing.", true);
  try {
    const result = await api(`/api/permits/${permitId}/issue`, { method: "POST", body: JSON.stringify({ decision, note }) });
    toast(result.message);
    $("#permit-dialog").close();
    await refreshCurrentPage();
  } catch (error) { toast(error.message, true); }
}

function showCompletionPanel(permitId) {
  $("#permit-action-panel").innerHTML = `<form class="completion-form" id="completion-form"><h3>Normalisation after job completion</h3><p class="small-text">Complete these checks before asking the administrator to close the permit.</p><div class="check-grid">${normalisationChecks()}</div><div class="dialog-actions"><button class="button primary" type="submit">Send completion for closure</button></div></form>`;
  $("#completion-form").addEventListener("submit", event => completePermit(event, permitId));
}

async function completePermit(event, permitId) {
  event.preventDefault();
  const form = event.currentTarget;
  const normalisation = collectChecks(form);
  try {
    const result = await api(`/api/permits/${permitId}/complete`, { method: "POST", body: JSON.stringify({ normalisation }) });
    toast(result.message);
    $("#permit-dialog").close();
    await refreshCurrentPage();
  } catch (error) { toast(error.message, true); }
}

async function closePermit(permitId) {
  if (!window.confirm("Close this permit after reviewing the normalisation details?")) return;
  try {
    const result = await api(`/api/permits/${permitId}/close`, { method: "POST", body: JSON.stringify({}) });
    toast(result.message);
    $("#permit-dialog").close();
    await refreshCurrentPage();
  } catch (error) { toast(error.message, true); }
}

async function deletePermit(permitId) {
  if (!window.confirm("Are you sure you want to permanently delete this permit? This action cannot be undone.")) return;
  try {
    const result = await api(`/api/permits/${permitId}`, { method: "DELETE" });
    toast(result.message);
    $("#permit-dialog").close();
    await refreshCurrentPage();
  } catch (error) { toast(error.message, true); }
}

async function renderApprovals() {
  const [userData, actionablePermitsData] = await Promise.all([api("/api/users/pending"), api("/api/permits/actionable")]);
  const permitsForApproval = actionablePermitsData.permits;
  const allUsers = userData.users;
  const pendingUserCount = allUsers.filter(u => u.approvalStatus === "pending").length;

  function renderUserList(users) {
    if (!users.length) return `<p class="notice">${!allUsers.length ? 'No employees have registered yet.' : 'No employees match the current filters.'}</p>`;
    return users.map(user => `<article class="card request-card" data-user-request="${user.id}">
        <div>
          <h3>${escapeHtml(user.fullName)} <span class="small-text">(${escapeHtml(user.employeeId)})</span></h3>
          <div class="user-meta-container">
            <span class="user-meta-badge badge-division">Division: ${escapeHtml(user.division || "—")}</span>
            <span class="user-meta-badge badge-department">Department: ${escapeHtml(user.department || "—")}</span>
            <span class="user-meta-badge badge-designation">Designation: ${escapeHtml(user.designation || "—")}</span>
          </div>
          <p class="small-text request-timestamp">Requested ${formatDate(user.createdAt)}</p>
        </div>
        ${user.approvalStatus === 'pending' ? `
          <div class="request-actions"><select aria-label="Role for ${escapeHtml(user.fullName)}"><option value="requester">Requester</option><option value="issuer">Issuer</option><option value="safety">Safety</option><option value="admin">Administrator</option></select><button class="button danger small" data-reject-user="${user.id}" type="button">Reject</button><button class="button primary small" data-approve-user="${user.id}" type="button">Approve</button></div>
        ` : `
          <div class="request-actions">
            ${userStatusBadge(user.approvalStatus)} <span class="small-text" style="margin-left: 8px;">Role: ${escapeHtml(titleCase(user.role))}</span>
            ${isAdmin() && user.approvalStatus === 'approved' && user.id !== state.user.id && user.employeeId !== 'ADMIN-001' ? `
              <div class="kebab-menu">
                <button class="kebab-button" aria-label="More options for ${escapeHtml(user.fullName)}" data-kebab-for="${user.id}">&#8942;</button>
                <div class="kebab-dropdown" data-kebab-dropdown-for="${user.id}">
                  <button class="kebab-item danger" data-deactivate-user="${user.id}">Deactivate Account</button>
                </div>
              </div>
            ` : ''}
          </div>
        `}
      </article>`).join("");
  }

  const divisions = ['All', ...[...new Set(allUsers.map(u => u.division))].sort()];
  const divisionTabsHtml = `
    <div class="filter-group" id="user-division-filter-group">
      ${divisions.map(division => `
        <button class="filter-button" data-division-filter="${escapeHtml(division)}">${escapeHtml(division)}</button>
      `).join('')}
    </div>`;
  $("#page-content").innerHTML = `
    <section class="approval-block">
      <h2>Employee Accounts</h2>
      <p>Approve pending requests and view all registered employee accounts. Approved people can sign in to the application.</p>
      <div class="filter-group" id="user-filter-group">
        <button class="filter-button" data-filter="all">All</button>
        <button class="filter-button" data-filter="pending">Pending</button>
        <button class="filter-button" data-filter="approved">Approved</button>
        <button class="filter-button" data-filter="rejected">Rejected</button>
        <button class="filter-button" data-filter="deactivated">Deactivated</button>
      </div>
      ${divisionTabsHtml}
      <div id="user-list-container"></div>
    </section>
    <section class="approval-block"><h2>Permit decisions</h2><p>Every permit must be reviewed here before work begins. After job completion, review the normalisation items before closing.</p>
      ${permitsForApproval.length ? permitTable(permitsForApproval) : `<p class="notice">No permits are waiting for an administrator decision.</p>`}
    </section>`;

  const userListContainer = $("#user-list-container");
  function applyFilters() {
    $$("#user-filter-group .filter-button").forEach(btn => btn.classList.toggle("active", btn.dataset.filter === state.approvalsFilter));
    $$("#user-division-filter-group .filter-button").forEach(btn => btn.classList.toggle("active", btn.dataset.divisionFilter === state.usersDivisionFilter));

    let filteredUsers = allUsers;
    if (state.approvalsFilter !== 'all') {
      filteredUsers = filteredUsers.filter(u => u.approvalStatus === state.approvalsFilter);
    }
    if (state.usersDivisionFilter !== 'All') {
      filteredUsers = filteredUsers.filter(u => u.division === state.usersDivisionFilter);
    }

    userListContainer.innerHTML = renderUserList(filteredUsers);
    $$('[data-approve-user]', userListContainer).forEach(button => button.addEventListener("click", () => approveUser(button.dataset.approveUser)));
    $$('[data-reject-user]', userListContainer).forEach(button => button.addEventListener("click", () => rejectUser(button.dataset.rejectUser)));

    // Kebab menu listeners
    $$('.kebab-button', userListContainer).forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = button.nextElementSibling;
        const isOpening = !dropdown.classList.contains('show');

        // Close all other open dropdowns
        $$('.kebab-dropdown.show', userListContainer).forEach(d => d.classList.remove('show'));

        if (isOpening) {
          dropdown.classList.add('show');
        }
      });
    });

    $$('.kebab-item[data-deactivate-user]', userListContainer).forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        button.closest('.kebab-dropdown').classList.remove('show');
        deactivateUser(button.dataset.deactivateUser);
      });
    });
  }

  $$("#user-filter-group .filter-button").forEach(button => {
    button.addEventListener("click", () => {
      state.approvalsFilter = button.dataset.filter;
      applyFilters();
    });
  });

  $$("#user-division-filter-group .filter-button").forEach(button => {
    button.addEventListener("click", () => {
      state.usersDivisionFilter = button.dataset.divisionFilter;
      applyFilters();
    });
  });

  if (!divisions.includes(state.usersDivisionFilter)) {
    state.usersDivisionFilter = 'All';
  }
  applyFilters();

  attachPermitRows();
  updatePendingBadge(pendingUserCount);
}

async function approveUser(id) {
  const card = $(`[data-user-request="${id}"]`);
  const role = $("select", card).value;
  if (role === "admin" && !window.confirm("This gives the person full control over access and permit approval. Continue?")) return;
  try {
    const result = await api(`/api/users/${id}/approve`, { method: "POST", body: JSON.stringify({ role }) });
    toast(result.message);
    await renderApprovals();
  } catch (error) { toast(error.message, true); }
}

async function rejectUser(id) {
  if (!window.confirm("Reject this access request?")) return;
  try {
    const result = await api(`/api/users/${id}/reject`, { method: "POST", body: JSON.stringify({}) });
    toast(result.message);
    await renderApprovals();
  } catch (error) { toast(error.message, true); }
}

async function deactivateUser(id) {
  if (!window.confirm("Are you sure you want to deactivate this user account? They will no longer be able to sign in.")) return;
  try {
    const result = await api(`/api/users/${id}`, { method: "DELETE" });
    toast(result.message || "User account deactivated.");
    await renderApprovals();
  } catch (error) { toast(error.message, true); }
}

function updatePendingBadge(count) {
  const badge = $("#pending-badge");
  badge.textContent = count || 0;
  badge.style.display = count ? "block" : "none";
}

async function go(page) {
  // Reset user filter when navigating away from the approvals page
  if (state.page === "approvals" && page !== "approvals") {
    state.approvalsFilter = "all";
    state.usersDivisionFilter = "all";
  }
  if (state.page === "permits" && page !== "permits" && isAdmin()) {
    state.permitsDivisionFilter = "all";
  }
  state.page = page;
  $(".sidebar")?.classList.remove("open");
  const title = { dashboard: "Dashboard", "new-permit": "New permit", permits: "Permits", approvals: "Approval centre" }[page] || "Dashboard";
  $("#page-title").textContent = title;
  $("#page-kicker").textContent = page === "approvals" ? "ADMINISTRATOR CONTROL" : "CONTROLLED WORKFLOW";
  $$(".nav-link[data-page]").forEach(link => link.classList.toggle("active", link.dataset.page === page));
  try {
    if (page === "dashboard") await renderDashboard();
    else if (page === "new-permit") await renderNewPermit();
    else if (page === "permits") await renderPermits();
    else if (page === "approvals" && isAdmin()) await renderApprovals();
    else await renderDashboard();
  } catch (error) { toast(error.message, true); }
}

async function refreshCurrentPage() { await go(state.page); }

function setUserUi() {
  $("#side-user").innerHTML = `<strong>${escapeHtml(state.user.fullName)}</strong>`;
  $("#header-user").insertAdjacentHTML("beforeend", `<span class="avatar">${escapeHtml(initials(state.user.fullName))}</span><span>${escapeHtml(state.user.fullName)}</span>`);
  $("#admin-nav").classList.toggle("hidden", !isAdmin());
}

function showApp() {
  $("#auth-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  setUserUi();
  initPushNotifications();
  go("dashboard");
}

function showAuth() {
  state.user = null;
  state.token = "";
  sessionStorage.removeItem("slr-permit-token");
  $("#app-view").classList.add("hidden");
  $("#auth-view").classList.remove("hidden");
}

function switchAuth(tab) {
  $$("[data-auth-tab]").forEach(button => button.classList.toggle("active", button.dataset.authTab === tab));
  $("#login-form").classList.toggle("hidden", tab !== "login");
  $("#register-form").classList.toggle("hidden", tab !== "register");
}

async function signIn(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const submit = $("button[type=submit]", form);
  submit.disabled = true;
  try {
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.token = data.token;
    state.user = data.user;
    sessionStorage.setItem("slr-permit-token", state.token);
    form.reset();
    showApp();
  } catch (error) { toast(error.message, true); }
  finally { submit.disabled = false; }
}

async function requestAccess(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;

  const formData = new FormData(form);
  if (formData.get("password") !== formData.get("confirmPassword")) {
    return toast("The passwords do not match. Please re-enter them.", true);
  }

  const submit = $("button[type=submit]", form);
  submit.disabled = true;
  try {
    const data = await api("/api/auth/register", { method: "POST", body: JSON.stringify(Object.fromEntries(formData)) });
    toast(data.message);
    form.reset();
    switchAuth("login");
  } catch (error) { toast(error.message, true); }
  finally { submit.disabled = false; }
}

async function signOut() {
  try {
    if (state.token) {
      const registration = await navigator.serviceWorker?.ready;
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) await api("/api/notifications/unsubscribe", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
      await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
    }
  } catch (error) {
    console.warn("Failed to clean up session on server during sign-out:", error);
    /* Local sign-out still succeeds. */ }
  showAuth();
}

function showPasswordDialog() {
  $("#dialog-content").innerHTML = `<article class="permit-detail">
    <header class="detail-head"><p class="eyebrow">ACCOUNT SECURITY</p><h2>Change password</h2><p class="detail-meta">Use a unique password with at least 12 characters. This is especially important for the first administrator account.</p></header>
    <form id="change-password-form" class="completion-form">
      <label>Current password<span class="password-wrapper"><input name="currentPassword" type="password" autocomplete="current-password" required /><button type="button" class="eye-button" aria-label="Show password"></button></span></label>
      <label>New password<span class="password-wrapper"><input name="newPassword" type="password" autocomplete="new-password" minlength="12" required /><button type="button" class="eye-button" aria-label="Show password"></button></span></label>
      <label>Confirm new password<span class="password-wrapper"><input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required /><button type="button" class="eye-button" aria-label="Show password"></button></span></label>
      <div class="dialog-actions"><button class="button primary" type="submit">Update password</button></div>
    </form>
  </article>`;
  const dialog = $("#permit-dialog");
  dialog.showModal();
  $("#change-password-form").addEventListener("submit", changePassword);
  $$('.eye-button', dialog).forEach(btn => {
    btn.innerHTML = ICONS.eye;
    btn.addEventListener('click', togglePasswordVisibility);
  });
}

async function changePassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const fields = Object.fromEntries(new FormData(form));
  if (fields.newPassword !== fields.confirmPassword) return toast("The new-password confirmation does not match.", true);
  try {
    const result = await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: fields.currentPassword, newPassword: fields.newPassword }) });
    toast(result.message);
    $("#permit-dialog").close();
  } catch (error) { toast(error.message, true); }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
}

function setupInstallButton() {
  const installContainer = $("#install-container");
  const installButton = $("#install-button", installContainer);
  if (!installButton || !installContainer) return;

  async function handleInstallClick() {
    if (!deferredInstallPrompt) return;
    await deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === "accepted") toast("App installed successfully!");
    deferredInstallPrompt = null;
    installContainer.classList.add("hidden");
  }

  installButton.addEventListener("click", handleInstallClick);

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installContainer.classList.remove("hidden");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    installContainer.classList.add("hidden");
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function initPushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !state.config.vapidPublicKey) {
    $("#notifications-button").classList.add("hidden");
    return;
  }

  const pushButton = $("#notifications-button");
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  function updateUi() {
    pushButton.classList.toggle("active", !!subscription);
    pushButton.setAttribute("aria-label", subscription ? "Disable notifications" : "Enable notifications");
  }

  pushButton.addEventListener("click", async () => {
    pushButton.disabled = true;
    if (subscription) {
      try {
        await api("/api/notifications/unsubscribe", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
        await subscription.unsubscribe();
        subscription = null;
        toast("Notifications disabled.");
      } catch (error) { toast("Could not disable notifications.", true); }
    } else {
      if (Notification.permission === "denied") {
        toast("Notification permission was denied. Please enable it in your browser settings.", true);
        pushButton.disabled = false;
        return;
      }
      try {
        const applicationServerKey = urlBase64ToUint8Array(state.config.vapidPublicKey);
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        await api("/api/notifications/subscribe", { method: "POST", body: JSON.stringify(subscription) });
        toast("Notifications enabled successfully!");
      } catch (error) { subscription = null; toast("Could not enable notifications.", true); }
    }
    updateUi();
    pushButton.disabled = false;
  });
  updateUi();
}

function listenForServiceWorkerUpdates() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", event => {
    if (event.data?.type === "NEW_VERSION_AVAILABLE") {
      const updateToast = $("#update-toast");
      if (updateToast) {
        updateToast.classList.remove("hidden");
        $("#update-now-button")?.addEventListener("click", () => window.location.reload());
      }
    } else if (event.data?.type === "navigate-to-permit" && event.data.permitId) {
      // Handle navigation from a push notification click
      openPermit(event.data.permitId);
    }
  });
}

async function bootstrap() {
  try {
    state.config = await api("/api/config");

    // DEVELOPER NOTE: The following brittle JavaScript logic has been removed.
    // These features should be implemented in static HTML and CSS files instead
    // of being dynamically created by JavaScript on startup.
    // 1. Removed dynamic injection of a <style> tag.
    // 2. Removed the unprofessional watermark from the sidebar.
    // 3. Removed code that dynamically inserted a "Confirm Password" field.
    //    (The <input name="confirmPassword"> should be in index.html).
    // 4. Removed code that wrapped password inputs and added a visibility
    //    toggle button. (This structure should be in index.html).

    registerServiceWorker();
    listenForServiceWorkerUpdates();
    initGlobalAlerts();

    const registerDivisionSelect = $("#register-division");
    const registerDepartmentSelect = $("#register-department");
    registerDivisionSelect.innerHTML = optionHtml(state.config.divisions, "", "Select division");
    registerDepartmentSelect.innerHTML = optionHtml(state.config.departments, "", "Select department");

    registerDivisionSelect.addEventListener('change', (event) => {
      const selectedDivision = event.target.value;
      if (selectedDivision === 'CMD') {
        const cmdDepartments = ['Mechanical', 'Electrical/Instrumentation'];
        registerDepartmentSelect.innerHTML = optionHtml(cmdDepartments, '', "Select department");
      } else {
        registerDepartmentSelect.innerHTML = optionHtml(state.config.departments, '', "Select department");
      }
    });
    $("#register-designation").innerHTML = optionHtml(state.config.designations, "", "Select designation");

    $$(".eye-button").forEach(btn => {
      btn.innerHTML = ICONS.eye;
      btn.addEventListener("click", togglePasswordVisibility);
    });

    $$("[data-auth-tab]").forEach(button => button.addEventListener("click", () => switchAuth(button.dataset.authTab)));
    $("#login-form").addEventListener("submit", signIn);
    $("#register-form").addEventListener("submit", requestAccess);
    $$(".nav-link[data-page]").forEach(button => button.addEventListener("click", () => go(button.dataset.page)));
    $("#change-password-button").addEventListener("click", showPasswordDialog);
    $("#logout-button").addEventListener("click", signOut);
    $("#mobile-menu").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
    $("#close-dialog").addEventListener("click", () => $("#permit-dialog").close());

    // Global listener to close kebab menus when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.kebab-menu')) {
        $$('.kebab-dropdown.show').forEach(d => d.classList.remove('show'));
      }
    });
    $("#permit-dialog").addEventListener("click", event => { if (event.target === $("#permit-dialog")) event.currentTarget.close(); });
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      const warning = $("#insecure-warning");
      if (warning) warning.classList.remove("hidden");
    }
    setupInstallButton();
    if (state.token) {
      try {
        state.user = (await api("/api/auth/me")).user;
        showApp();
      } catch (error) {
        console.error("Session restore failed, showing login:", error);
        showAuth();
      }
    }
  } catch (error) { toast(`Could not start the application: ${error.message}`, true); }
}

bootstrap();
