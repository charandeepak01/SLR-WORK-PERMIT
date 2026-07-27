const state = {
  token: sessionStorage.getItem("slr-permit-token") || "",
  user: null,
  config: { departments: [], divisions: [] },
  page: "dashboard",
};

const ICONS = {
  eye: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
  eyeOff: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
};

const labels = {
  authorityChecked: "Issuing authority checked all precautions",
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
  utilityServices: "Service identified (steam / air / water)",
  utilityValvesTagged: "Utility valve closed and tagged",
  utilityDepressurised: "Utility line depressurised",
  electricalDrivePanel: "Drive / panel identified",
  electricalFuseRemoved: "Fuse removed",
  electricalIsolatorLocked: "Isolator put off and locked out",
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
  oscillator.type = "square";
  oscillator.frequency.value = 740;
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
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/login") showAuth();
    throw new Error(result.error || "The request could not be completed.");
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

function statusBadge(status) { return `<span class="status ${escapeHtml(status)}">${escapeHtml(titleCase(status))}</span>`; }

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
  $("#page-content").innerHTML = `
    <section class="card dashboard-actions">
      <div><h2>${isAdmin() ? "You control access and permit approval" : "Every safe job starts with a controlled permit"}</h2><p>${isAdmin() ? "Review pending access requests and permits before any work starts." : "Submit the work details and safety checks. The administrator must issue the permit before work begins."}</p></div>
      <button class="button primary" type="button" id="dashboard-new-permit">Create permit</button>
    </section>
    <section class="stats" aria-label="Permit status summary">
      <div class="card stat"><strong>${counts.pending_approval || 0}</strong><span>Awaiting approval</span></div>
      <div class="card stat"><strong>${counts.issued || 0}</strong><span>Active permits</span></div>
      <div class="card stat"><strong>${counts.job_completed || 0}</strong><span>Ready to close</span></div>
      <div class="card stat"><strong>${counts.closed || 0}</strong><span>Closed permits</span></div>
    </section>
    <section><div class="section-title"><h2>Recent permits</h2><button class="link-button" id="view-all-permits" type="button">View all →</button></div>${permitTable(data.recent)}</section>`;
  $("#dashboard-new-permit").addEventListener("click", () => go("new-permit"));
  $("#view-all-permits").addEventListener("click", () => go("permits"));
  attachPermitRows();
  updatePendingBadge(data.pendingUsers);
}

function checklistGroup(title, description, keys) {
  return `<div class="type-card"><strong>${escapeHtml(title)}</strong>${description ? `<p class="small-text">${escapeHtml(description)}</p>` : ""}<div class="check-grid">${keys.map(key => checkbox(key)).join("")}</div></div>`;
}

async function renderNewPermit() {
  $("#page-content").innerHTML = `
    <form id="permit-form" class="card form-card" novalidate>
      <div class="form-intro"><h2>New safe work permit</h2><p>Complete the activity-specific checks that are applicable. This request remains inactive until the administrator reviews and issues it.</p></div>
      <section class="form-section">
        <h3>1. Work details</h3><p>These are the main details from the top of the paper permit.</p>
        <div class="form-grid three">
          <label class="full">Details of work to be carried out<textarea name="workDescription" required maxlength="2000" placeholder="Describe the work, method, and equipment involved."></textarea></label>
          <label>Department<select name="department" required>${optionHtml(state.config.departments, state.user.department, "Select department")}</select></label>          
          <label>Mobile number for contact<input name="contactNumber" type="tel" required pattern="\\d{10}" maxlength="10" placeholder="Enter 10-digit mobile number" title="Enter a 10-digit mobile number." value="${escapeHtml(state.user.mobileNumber || '')}" /></label>
          <label>Area / location<input name="area" required maxlength="200" placeholder="Example: MBF 1 - Cast house" /></label>
          <label>Equipment / asset<input name="equipment" maxlength="200" placeholder="Example: Main blower" /></label>
          <label>Valid from<input name="validFrom" type="datetime-local" required /></label>
          <label>Valid until<input name="validUntil" type="datetime-local" required /></label>
        </div>
      </section>
      <section class="form-section">
        <h3>2. Isolation required</h3><p>Record the completed precautions. Add only controls that are actually applicable to this job.</p>
        <div class="check-grid">${[
          "authorityChecked", "topFiringDone", "systemIsolated", "steamNitrogenPurge", "coBelow50"
        ].map(key => checkbox(key)).join("")}</div>
        <div class="form-grid" style="margin-top: 14px"><label>CO reading (ppm)<input name="coPpm" type="number" min="0" max="10000" placeholder="Enter measured CO value" /></label></div>
        <div class="check-grid" style="margin-top: 14px">
          ${checklistGroup("Mechanical isolation", "Equipment/pipeline, valves, pressure and hazardous material", ["mechanicalEquipmentIsolation", "mechanicalValvesClosed", "mechanicalDepressurised", "mechanicalPressureRelievedCooled", "mechanicalPlcDeselected", "mechanicalHazardousMaterialDrained"])}
          ${checklistGroup("Utility isolation", "Steam, air, water, gas or other service", ["utilityServices", "utilityValvesTagged", "utilityDepressurised"])}
          ${checklistGroup("Electrical isolation", "Drive/panel isolation and lock-out / tag-out", ["electricalDrivePanel", "electricalFuseRemoved", "electricalIsolatorLocked", "electricalTagOut"])}
        </div>
      </section>
      <section class="form-section">
        <h3>3. General safety precautions</h3><p>Select the permit activity, then record the specific checks completed.</p>
        <div class="check-grid" style="margin-top:14px">${["tagsBoards", "cordoned", "ppe"].map(key => checkbox(key)).join("")}</div>
        <div class="check-grid" style="margin-top:14px">
          ${checklistGroup("Hot work", "Fire and combustible-material controls", ["hotEquipment", "hotAreaClear", "hotMasking", "hotOpenings", "hotExtinguisher", "hotPurging"])}
          ${checklistGroup("Confined space", "Atmosphere, entry and rescue controls", ["confinedAirTest", "oxygen", "openings", "entryPermit", "standby", "trained"])}
          ${checklistGroup("Working at height", "Scaffolding, fall protection and access", ["scaffolding", "safetyBelt", "ladders", "accessToolhold"])}
          ${checklistGroup("Excavation", "Excavation method and underground services", ["excavationManual", "cables", "pipes"])}
        </div>
      </section>
      <p class="notice">By submitting, you confirm these details are accurate. The job must not begin until the administrator has issued the permit.</p>
      <div class="submit-row"><button class="button secondary" type="button" id="cancel-permit">Cancel</button><button class="button primary" type="submit">Send for administrator approval</button></div>
    </form>`;
  $("#cancel-permit").addEventListener("click", () => go("dashboard"));
  $("#permit-form").addEventListener("submit", submitPermit);
}

function collectChecks(form) {
  const output = {};
  $$('[data-check]', form).forEach(element => { output[element.dataset.check] = element.checked; });
  const coPpm = form.elements.coPpm?.value.trim();
  if (coPpm) output.coPpm = Number(coPpm);
  return output;
}

async function submitPermit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const formData = new FormData(form);
  const validFrom = new Date(formData.get("validFrom"));
  const validUntil = new Date(formData.get("validUntil"));
  if (validUntil <= validFrom) return toast("Valid-until time must be later than the start time.", true);
  const checks = collectChecks(form);
  const isolationKeys = [
    "authorityChecked", "topFiringDone", "systemIsolated", "steamNitrogenPurge", "coBelow50", "coPpm",
    "mechanicalEquipmentIsolation", "mechanicalValvesClosed", "mechanicalDepressurised", "mechanicalPressureRelievedCooled", "mechanicalPlcDeselected", "mechanicalHazardousMaterialDrained",
    "utilityServices", "utilityValvesTagged", "utilityDepressurised",
  ];
  const electricalKeys = ["electricalDrivePanel", "electricalFuseRemoved", "electricalIsolatorLocked", "electricalTagOut"];
  const department = formData.get("department") || "";
  const contactNumber = String(formData.get("contactNumber") || "").trim();
  if (!/^\d{10}$/.test(contactNumber)) {
    return toast("Please enter a valid 10-digit contact number.", true);
  }
  const payload = {
    workDescription: formData.get("workDescription"), department, area: formData.get("area"), equipment: formData.get("equipment"), contactNumber,
    validFrom: validFrom.toISOString(), validUntil: validUntil.toISOString(), jobTypes: formData.getAll("jobTypes"),
    isolations: Object.fromEntries(Object.entries(checks).filter(([key]) => isolationKeys.includes(key))),
    precautions: Object.fromEntries(Object.entries(checks).filter(([key]) => !isolationKeys.includes(key) && !electricalKeys.includes(key))),
    electrical: Object.fromEntries(Object.entries(checks).filter(([key]) => electricalKeys.includes(key))),
  };
  const submit = $("button[type=submit]", form);
  submit.disabled = true;
  try {
    const result = await api("/api/permits", { method: "POST", body: JSON.stringify(payload) });
    toast(`${result.permitNo} sent for approval.`);
    go("permits");
  } catch (error) { toast(error.message, true); }
  finally { submit.disabled = false; }
}

async function renderPermits() {
  const data = await api("/api/permits");
  $("#page-content").innerHTML = `<section><div class="section-title"><div><h2>${isAdmin() ? "All permits" : "My submitted permits"}</h2><p class="small-text">Select a permit to view its safety checklist, workflow, and audit trail.</p></div><button id="permit-add" class="button primary" type="button">New permit</button></div>${permitTable(data.permits)}</section>`;
  $("#permit-add").addEventListener("click", () => go("new-permit"));
  attachPermitRows();
}

function detailItem(label, value) { return `<div class="detail-box"><b>${escapeHtml(label)}</b><span>${escapeHtml(value || "—")}</span></div>`; }

function normalisationChecks() {
  return ["allPersonnelWithdrawn", "guardsReplaced", "looseMaterialsRemoved", "trialTaken", "servicesRestored"].map(key => checkbox(key)).join("");
}

async function openPermit(permitId) {
  try {
    const data = await api(`/api/permits/${permitId}`);
    const p = data.permit;
    const jobTypes = (p.jobTypes || []).map(type => titleCase(type));
    const dialogContent = `
      <article class="permit-detail"><header class="detail-head"><p class="eyebrow">DIGITAL SAFE WORK PERMIT</p><h2>${escapeHtml(p.permitNo)} ${statusBadge(p.status)}</h2><p class="detail-meta">Submitted by ${escapeHtml(p.requesterName)} on ${formatDate(p.requestedAt)}</p></header>
      <section class="detail-grid">${detailItem("Division", p.division)}${detailItem("Department", p.department)}${detailItem("Area / location", p.area)}${detailItem("Equipment", p.equipment)} ${detailItem("For any further information", `Call ${p.requesterName} at ${p.contactNumber || "—"}`)}</section>
      <section class="detail-section"><h3>Work to be carried out</h3><p>${escapeHtml(p.workDescription).replaceAll("\n", "<br>")}</p></section>
      <section class="detail-section"><h3>Work activity</h3>${jobTypes.length ? `<div class="checked-list">${jobTypes.map(type => `<span>${escapeHtml(type)}</span>`).join("")}</div>` : `<p class="small-text">General work permit</p>`}</section>
      <section class="detail-section"><h3>Isolation controls</h3>${checkedSummary(p.isolations)}${p.isolations?.coPpm !== undefined ? `<p class="small-text">Recorded CO reading: ${escapeHtml(p.isolations.coPpm)} ppm</p>` : ""}</section>
      <section class="detail-section"><h3>General safety precautions</h3>${checkedSummary(p.precautions)}</section>
      <section class="detail-section"><h3>Electrical isolation</h3>${checkedSummary(p.electrical)}</section>
      ${p.issuerNote ? `<section class="detail-section"><h3>Administrator note</h3><p>${escapeHtml(p.issuerNote)}</p></section>` : ""}
      ${p.status === "job_completed" || p.status === "closed" ? `<section class="detail-section"><h3>Normalisation after job completion</h3>${checkedSummary(p.normalisation)}</section>` : ""}
      <section class="detail-section"><h3>Audit trail</h3><ul class="audit-list">${data.audit.map(entry => `<li><strong>${escapeHtml(entry.action)}</strong><small>${escapeHtml(entry.actor)} · ${formatDate(entry.createdAt)}</small>${entry.detail?.note ? `<small>Note: ${escapeHtml(entry.detail.note)}</small>` : ""}</li>`).join("")}</ul></section>
      <div class="dialog-actions">
        <button class="button secondary" type="button" id="print-permit">Print / save as PDF</button>
        ${isAdmin() && p.status === "pending_approval" ? `<button class="button primary" type="button" id="review-permit">Review permit</button>` : ""}
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
    $("#review-permit")?.addEventListener("click", () => showReviewPanel(p.id));
    $("#close-permit")?.addEventListener("click", () => closePermit(p.id));
    $("#finish-job")?.addEventListener("click", () => showCompletionPanel(p.id));
    $("#delete-permit")?.addEventListener("click", () => deletePermit(p.id));
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
  const [userData, permitsData] = await Promise.all([api("/api/users/pending"), api("/api/permits")]);
  const permitsForApproval = permitsData.permits.filter(p => p.status === "pending_approval" || p.status === "job_completed");
  $("#page-content").innerHTML = `
    <section class="approval-block"><h2>Employee access requests</h2><p>Approve only people whose identity, division, department, and role have been verified. Approved people can then sign in.</p>
      ${userData.users.length ? userData.users.map(user => `<article class="card request-card" data-user-request="${user.id}"><div><h3>${escapeHtml(user.fullName)} <span class="small-text">(${escapeHtml(user.employeeId)})</span></h3><p>${escapeHtml(user.division || "—")} · ${escapeHtml(user.department)} · Requested ${formatDate(user.createdAt)}</p></div><div class="request-actions"><select aria-label="Role for ${escapeHtml(user.fullName)}"><option value="requester">Requester</option><option value="issuer">Issuer</option><option value="safety">Safety</option><option value="admin">Administrator</option></select><button class="button danger small" data-reject-user="${user.id}" type="button">Reject</button><button class="button primary small" data-approve-user="${user.id}" type="button">Approve</button></div></article>`).join("") : `<p class="notice">No employee access requests are waiting.</p>`}
    </section>
    <section class="approval-block"><h2>Permit decisions</h2><p>Every permit must be reviewed here before work begins. After job completion, review the normalisation items before closing.</p>
      ${permitsForApproval.length ? permitTable(permitsForApproval) : `<p class="notice">No permits are waiting for an administrator decision.</p>`}
    </section>`;
  $$('[data-approve-user]').forEach(button => button.addEventListener("click", () => approveUser(button.dataset.approveUser)));
  $$('[data-reject-user]').forEach(button => button.addEventListener("click", () => rejectUser(button.dataset.rejectUser)));
  attachPermitRows();
  updatePendingBadge(userData.users.length);
}

async function approveUser(id) {
  const card = $(`[data-user-request="${id}"]`);
  const role = $("select", card).value;
  if (role === "admin" && !window.confirm("This gives the person full control over access and permit approval. Continue?")) return;
  try {
    const result = await api(`/api/users/${id}/approve`, { method: "POST", body: JSON.stringify({ role }) });
    toast(result.message);
    renderApprovals();
  } catch (error) { toast(error.message, true); }
}

async function rejectUser(id) {
  if (!window.confirm("Reject this access request?")) return;
  try {
    const result = await api(`/api/users/${id}/reject`, { method: "POST", body: JSON.stringify({}) });
    toast(result.message);
    renderApprovals();
  } catch (error) { toast(error.message, true); }
}

function updatePendingBadge(count) {
  const badge = $("#pending-badge");
  badge.textContent = count || 0;
  badge.style.display = count ? "block" : "none";
}

async function go(page) {
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

  const mobileNumber = String(formData.get("mobileNumber") || "").trim();
  if (!/^\d{10}$/.test(mobileNumber)) {
    return toast("Please enter a valid 10-digit mobile number.", true);
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
  } catch { /* Local sign-out still succeeds. */ }
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
  let installButton = null;

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredInstallPrompt = e;

    // If the button doesn't exist, create it
    if (!installButton) {
      const authView = $("#auth-view");
      if (authView) {
        const buttonContainer = document.createElement("div");
        buttonContainer.className = "install-container";
        buttonContainer.innerHTML = `<button type="button" id="install-button" class="button secondary">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18" style="margin-right: 8px;"><path d="M12 15.5a1 1 0 0 1-.71-.29l-4-4a1 1 0 1 1 1.42-1.42L12 13.09l3.29-3.3a1 1 0 1 1 1.42 1.42l-4 4a1 1 0 0 1-.71.29Z"/><path d="M12 3a1 1 0 0 0-1 1v8a1 1 0 0 0 2 0V4a1 1 0 0 0-1-1Z"/><path d="M21 13a1 1 0 0 0-1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 0-2 0v4a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-4a1 1 0 0 0-1-1Z"/></svg>
          Install App
        </button>`;
        // Add some style to position it nicely on the login page
        buttonContainer.style.textAlign = "center";
        buttonContainer.style.padding = "20px 0 10px 0";
        buttonContainer.style.borderTop = "1px solid #eee";
        buttonContainer.style.marginTop = "20px";

        // Find the login form and insert the button before it
        const loginForm = $("#login-form");
        loginForm?.parentElement.insertBefore(buttonContainer, loginForm);

        installButton = $("#install-button");
        installButton.addEventListener("click", handleInstallClick);
      }
    }
    // Show the button if it exists
    if (installButton) installButton.parentElement.style.display = "block";
  });

  async function handleInstallClick() {
    if (!deferredInstallPrompt) return;
    await deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === "accepted") toast("App installed successfully!");
    deferredInstallPrompt = null;
    if (installButton) installButton.parentElement.style.display = "none";
  }

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (installButton) installButton.parentElement.style.display = "none";
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

    const style = document.createElement('style');
    style.textContent = `
      .password-wrapper { position: relative; display: flex; align-items: center; }
      .password-wrapper input { padding-right: 40px !important; width: 100%; box-sizing: border-box; }
      .eye-button { position: absolute; right: 0; top: 0; bottom: 0; width: 40px; background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; opacity: 0.6; color: inherit; }
      .eye-button:hover { opacity: 1; }
      .eye-button svg { pointer-events: none; }
      .watermark {
        /* This is positioned at the bottom of the sidebar */
        margin-top: auto;
        padding: 20px 10px;
        text-align: center;
        font-size: 11px;
        font-family: sans-serif;
        font-weight: 500;
        color: #aaa;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);

    const watermark = document.createElement('div');
    watermark.className = 'watermark';
    watermark.textContent = 'created by charan deepak c';
    $(".sidebar")?.appendChild(watermark);

    registerServiceWorker();
    listenForServiceWorkerUpdates();
    initGlobalAlerts();
    $("#register-division").innerHTML = optionHtml(state.config.divisions, "", "Select division");
    $("#register-department").innerHTML = optionHtml(state.config.departments, "", "Select department");

    const registerPasswordInput = $('#register-form input[name="password"]');
    if (registerPasswordInput) {
      const passwordLabel = registerPasswordInput.closest('label');
      if (passwordLabel) {
        const confirmLabel = document.createElement('label');
        confirmLabel.innerHTML = 'Confirm password<input type="password" name="confirmPassword" autocomplete="new-password" minlength="12" required />';
        passwordLabel.parentNode.insertBefore(confirmLabel, passwordLabel.nextSibling);
      }
    }

    $$('#login-form input[type="password"], #register-form input[type="password"]').forEach(input => {
      if (input.closest('.password-wrapper')) return;
      const wrapper = document.createElement('span');
      wrapper.className = 'password-wrapper';
      const parent = input.parentElement;
      parent.insertBefore(wrapper, input);
      wrapper.appendChild(input);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'eye-button';
      button.setAttribute('aria-label', 'Show password');
      button.innerHTML = ICONS.eye;
      button.addEventListener('click', togglePasswordVisibility);
      wrapper.appendChild(button);
    });

    $$("[data-auth-tab]").forEach(button => button.addEventListener("click", () => switchAuth(button.dataset.authTab)));
    $("#login-form").addEventListener("submit", signIn);
    $("#register-form").addEventListener("submit", requestAccess);
    $$(".nav-link[data-page]").forEach(button => button.addEventListener("click", () => go(button.dataset.page)));
    $("#change-password-button").addEventListener("click", showPasswordDialog);
    $("#logout-button").addEventListener("click", signOut);
    $("#mobile-menu").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
    $("#close-dialog").addEventListener("click", () => $("#permit-dialog").close());
    $("#permit-dialog").addEventListener("click", event => { if (event.target === $("#permit-dialog")) event.currentTarget.close(); });
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      const warning = $("#insecure-warning");
      if (warning) warning.classList.remove("hidden");
    }
    setupInstallButton();
    if (state.token) {
      try { state.user = (await api("/api/auth/me")).user; showApp(); }
      catch { showAuth(); } }
  } catch (error) { toast(`Could not start the application: ${error.message}`, true); }
}

bootstrap();
