(() => {
  "use strict";

  // ================= Constantes =================
  const STATUS = [
    { id: "pendiente",  label: "Pendiente",    color: "var(--st-pend)" },
    { id: "ejecucion",  label: "En ejecución", color: "var(--st-run)" },
    { id: "detenida",   label: "Detenida",     color: "var(--st-stop)" },
    { id: "finalizada", label: "Finalizada",   color: "var(--st-done)" },
  ];
  const ST = Object.fromEntries(STATUS.map(s => [s.id, s]));
  const COLORS = ["#0f6b5c", "#1d5fd1", "#7c3aed", "#c2410c", "#be185d", "#a16207", "#0e7490", "#4d7c0f"];
  const MONTHS = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const MONTHS_L = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const DAY = 86400000;

  const cfg = window.APP_CONFIG || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const state = {
    me: null,            // perfil de la sesión
    projects: [], tasks: [], people: [],
    view: "project", sel: null,
    fAssignee: "", fStatus: "", scale: "auto",
  };

  // ================= Utilidades =================
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toMs = s => { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN; const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const toISO = ms => new Date(ms).toISOString().slice(0, 10);
  const todayISO = () => { const n = new Date(); return toISO(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
  const fmt = s => { const ms = toMs(s); if (isNaN(ms)) return "—"; const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const days = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY) + 1;
  const initials = n => (n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  const isLate = t => t.status !== "finalizada" && toMs(t.end_date) < toMs(todayISO());
  const svg = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
  const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const safeColor = c => COLORS.includes(c) ? c : COLORS[0];
  let toastT;
  const toast = msg => { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2800); };

  const isAdmin = () => state.me?.role === "admin";
  const canEditTask = t => isAdmin() || t.assignee_id === state.me?.id;
  const projTasks = pid => state.tasks.filter(t => t.project_id === pid);
  const progress = pid => { const ts = projTasks(pid); if (!ts.length) return 0; return Math.round(ts.filter(t => t.status === "finalizada").length / ts.length * 100); };
  const personById = id => state.people.find(p => p.id === id);
  const nameOf = t => personById(t.assignee_id)?.full_name || "Sin asignar";
  const peopleIn = ts => { const m = new Map(); ts.forEach(t => { if (t.assignee_id && !m.has(t.assignee_id)) m.set(t.assignee_id, nameOf(t)); }); return [...m].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name)); };

  function errMsg(e) {
    const m = (e && (e.message || e.error_description || e.error)) || "";
    if (/Invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
    if (/Email not confirmed/i.test(m)) return "Confirma tu correo antes de iniciar sesión (revisa tu bandeja de entrada).";
    if (/User already registered/i.test(m)) return "Ya existe una cuenta con ese correo.";
    if (/Password should be at least/i.test(m)) return "La contraseña debe tener al menos 8 caracteres.";
    if (/rate limit|too many/i.test(m)) return "Demasiados intentos. Espera unos minutos y vuelve a intentar.";
    if (/administrador activo/i.test(m)) return "Debe existir al menos un administrador activo.";
    if (e && (e.code === "42501" || /row-level security|permission denied/i.test(m))) return "No tienes permiso para hacer este cambio.";
    if (e && e.code === "23514") return "Revisa las fechas: el fin debe ser igual o posterior al inicio.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión con el servidor. Revisa tu internet.";
    return m || "No se pudo completar la acción. Inténtalo de nuevo.";
  }

  // ================= Pantallas =================
  function show(screen) {
    ["#screenLoading", "#screenAuth", "#screenPending", "#screenApp"].forEach(s => $(s).hidden = s !== screen);
  }
  function authForm(which) {
    ["login", "signup", "forgot", "recovery"].forEach(k => {
      const id = { login: "#formLogin", signup: "#formSignup", forgot: "#formForgot", recovery: "#formRecovery" }[k];
      $(id).hidden = k !== which;
    });
    $("#authSubtitle").textContent = {
      login: "Inicia sesión para ver y gestionar los proyectos.",
      signup: "Crea tu cuenta para unirte al equipo.",
      forgot: "Te enviaremos un enlace para crear una nueva contraseña.",
      recovery: "Escribe tu nueva contraseña.",
    }[which];
    document.querySelectorAll(".auth .err, .auth .ok").forEach(el => el.textContent = "");
  }
  document.querySelectorAll("[data-auth]").forEach(b => b.addEventListener("click", () => authForm(b.dataset.auth)));

  const redirectUrl = () => location.origin + location.pathname;

  $("#formLogin").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#l-email").value.trim(), password = $("#l-pass").value;
    if (!validEmail(email) || !password) return $("#l-err").textContent = "Escribe tu correo y contraseña.";
    $("#l-btn").disabled = true; $("#l-err").textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email, password });
    $("#l-btn").disabled = false;
    if (error) $("#l-err").textContent = errMsg(error);
  });

  $("#formSignup").addEventListener("submit", async e => {
    e.preventDefault();
    const full_name = $("#s-name").value.trim(), email = $("#s-email").value.trim(), password = $("#s-pass").value;
    $("#s-err").textContent = ""; $("#s-ok").textContent = "";
    if (!full_name) return $("#s-err").textContent = "Escribe tu nombre.";
    if (!validEmail(email)) return $("#s-err").textContent = "Revisa el correo.";
    if (password.length < 8) return $("#s-err").textContent = "La contraseña debe tener al menos 8 caracteres.";
    $("#s-btn").disabled = true;
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name }, emailRedirectTo: redirectUrl() } });
    $("#s-btn").disabled = false;
    if (error) return $("#s-err").textContent = errMsg(error);
    if (!data.session) $("#s-ok").textContent = "Cuenta creada. Revisa tu correo y confirma la dirección para poder entrar.";
  });

  $("#formForgot").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#f-email").value.trim();
    $("#f-err").textContent = ""; $("#f-ok").textContent = "";
    if (!validEmail(email)) return $("#f-err").textContent = "Revisa el correo.";
    $("#f-btn").disabled = true;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
    $("#f-btn").disabled = false;
    if (error) return $("#f-err").textContent = errMsg(error);
    $("#f-ok").textContent = "Si el correo está registrado, recibirás un enlace para crear una nueva contraseña.";
  });

  $("#formRecovery").addEventListener("submit", async e => {
    e.preventDefault();
    const password = $("#r-pass").value;
    if (password.length < 8) return $("#r-err").textContent = "La contraseña debe tener al menos 8 caracteres.";
    $("#r-btn").disabled = true;
    const { error } = await sb.auth.updateUser({ password });
    $("#r-btn").disabled = false;
    if (error) return $("#r-err").textContent = errMsg(error);
    inRecovery = false; toast("Contraseña actualizada"); startSession();
  });

  const logout = async () => { await sb.auth.signOut(); };
  $("#btnLogout").addEventListener("click", logout);
  $("#btnPendingLogout").addEventListener("click", logout);

  // ================= Sesión =================
  let inRecovery = false, channel = null, booted = false;

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { inRecovery = true; show("#screenAuth"); authForm("recovery"); return; }
    if (event === "SIGNED_OUT" || !session) { stopRealtime(); state.me = null; booted = false; show("#screenAuth"); authForm("login"); return; }
    if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && !inRecovery && !booted) { booted = true; setTimeout(startSession, 0); }
  });

  async function startSession() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { show("#screenAuth"); authForm("login"); return; }
    show("#screenLoading");
    const { data: me, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (inRecovery) { show("#screenAuth"); authForm("recovery"); return; }
    if (error || !me) { show("#screenAuth"); authForm("login"); $("#l-err").textContent = error ? errMsg(error) : "No se encontró tu perfil."; return; }
    if (!me.active) { $("#pendingEmail").textContent = me.email || user.email || ""; show("#screenPending"); return; }
    state.me = me;
    $("#meName").textContent = me.full_name || me.email;
    $("#meAvatar").textContent = initials(me.full_name || me.email);
    $("#meRole").textContent = me.role === "admin" ? "Administrador" : "Colaborador";
    $("#meRole").className = "role " + me.role;
    show("#screenApp");
    await loadAll();
    startRealtime();
  }

  async function loadAll() {
    const [p, t, u] = await Promise.all([
      sb.from("projects").select("*").order("start_date"),
      sb.from("tasks").select("*").order("start_date"),
      sb.from("profiles").select("*").order("full_name"),
    ]);
    const err = p.error || t.error || u.error;
    const b = $("#banner");
    if (err) { b.hidden = false; b.textContent = "No se pudieron cargar los datos: " + errMsg(err); }
    else b.hidden = true;
    if (!p.error) state.projects = p.data;
    if (!t.error) state.tasks = t.data;
    if (!u.error) {
      state.people = u.data;
      const mine = u.data.find(x => x.id === state.me?.id);
      if (mine) {
        if (!mine.active) { await sb.auth.signOut(); return; }
        if (mine.role !== state.me.role) { state.me = mine; return startSession(); }
        state.me = mine;
      }
    }
    render();
  }

  let reloadT;
  function startRealtime() {
    stopRealtime();
    channel = sb.channel("planes")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, queueReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, queueReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, queueReload)
      .subscribe(status => { $("#syncNote").textContent = status === "SUBSCRIBED" ? "En vivo · cambios compartidos" : "Conectado"; });
  }
  function stopRealtime() { if (channel) { sb.removeChannel(channel); channel = null; } }
  function queueReload() { clearTimeout(reloadT); reloadT = setTimeout(loadAll, 300); }

  // ================= Render =================
  function render() {
    if (!state.me) return;
    if (!state.projects.find(p => p.id === state.sel)) state.sel = state.projects[0]?.id || null;
    renderSidebar();
    if (state.view === "team") renderTeam(); else renderMain();
    $("#btnTeam").setAttribute("aria-current", state.view === "team");
    const pending = state.people.filter(p => !p.active).length;
    $("#teamCount").textContent = String(state.people.filter(p => p.active).length) + (isAdmin() && pending ? ` · ${pending} por aprobar` : "");
  }

  function renderSidebar() {
    const ul = $("#plist");
    if (!state.projects.length) { ul.innerHTML = `<li class="pcount">Aún no hay proyectos.</li>`; return; }
    ul.innerHTML = state.projects.map(p => {
      const ts = projTasks(p.id), pr = progress(p.id);
      return `<li><button type="button" class="pitem" data-pid="${esc(p.id)}" aria-current="${state.view === "project" && p.id === state.sel}">
        <span class="pdot" style="background:${safeColor(p.color)}"></span>
        <span class="pname">${esc(p.name)}</span>
        <span class="pcount mono">${pr}%</span>
        <span class="pmeta"><span class="pbar"><i style="width:${pr}%"></i></span><span>${ts.length} tarea${ts.length === 1 ? "" : "s"}</span></span>
      </button></li>`;
    }).join("");
  }

  function renderMain() {
    const view = $("#view");
    const p = state.projects.find(p => p.id === state.sel);
    if (!p) {
      view.innerHTML = `<div class="panel"><div class="empty"><h3>Crea tu primer proyecto</h3><p>Cada proyecto tiene su plan de trabajo: tareas asignadas a colaboradores, con fechas y estado, sobre una línea de tiempo.</p><button class="btn primary" type="button" data-act="new-project">${svg("i-plus")}Nuevo proyecto</button></div></div>`;
      return;
    }
    const admin = isAdmin();
    const all = projTasks(p.id);
    const tasks = all.filter(t => (!state.fAssignee || t.assignee_id === state.fAssignee) && (!state.fStatus || t.status === state.fStatus))
      .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date));
    const people = peopleIn(all);
    const counts = Object.fromEntries(STATUS.map(s => [s.id, all.filter(t => t.status === s.id).length]));
    const late = all.filter(isLate).length;
    const color = safeColor(p.color);
    const creator = personById(p.created_by);

    view.innerHTML = `
      <section class="phead">
        <div class="phead-txt">
          <div class="eyebrow" style="color:${color}">${esc(p.client || "Proyecto")}</div>
          <h2>${esc(p.name)}</h2>
          ${p.description ? `<p>${esc(p.description)}</p>` : ""}
          <div class="pfacts">
            <span>Responsable: <b>${esc(p.owner_name || "—")}</b></span>
            <span>Periodo: <b class="mono">${fmt(p.start_date)} → ${fmt(p.end_date)}</b></span>
            <span>Duración: <b class="mono">${days(p.start_date, p.end_date)} días</b></span>
            <span>Avance: <b class="mono">${progress(p.id)}%</b></span>
            ${creator ? `<span>Creado por: <b>${esc(creator.full_name)}</b></span>` : ""}
          </div>
        </div>
        <div class="actions">
          <button class="btn primary" type="button" data-act="new-task">${svg("i-plus")}${admin ? "Nueva tarea" : "Nueva tarea para mí"}</button>
          ${admin ? `<button class="btn" type="button" data-act="edit-project">${svg("i-edit")}Editar</button>
          <button class="btn danger" type="button" data-act="del-project">${svg("i-trash")}Eliminar</button>` : ""}
        </div>
      </section>

      <section class="stats" aria-label="Resumen de tareas">
        <div class="stat"><span class="n">${all.length}</span><span class="l">Tareas totales${late ? ` · <span class="chip late">${late} vencida${late === 1 ? "" : "s"}</span>` : ""}</span></div>
        ${STATUS.map(s => `<div class="stat"><span class="n" style="color:${s.color}">${counts[s.id]}</span><span class="l"><i class="sw" style="background:${s.color}"></i>${s.label}</span></div>`).join("")}
      </section>

      <section class="panel">
        <div class="panel-h">
          <h3>Línea de tiempo</h3>
          <div class="tools">
            <select class="f" id="fAssignee" aria-label="Filtrar por colaborador"><option value="">Todos los colaboradores</option>${people.map(x => `<option value="${esc(x.key)}"${x.key === state.fAssignee ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
            <select class="f" id="fStatus" aria-label="Filtrar por estado"><option value="">Todos los estados</option>${STATUS.map(s => `<option value="${s.id}"${s.id === state.fStatus ? " selected" : ""}>${s.label}</option>`).join("")}</select>
            <div class="seg" role="group" aria-label="Escala">
              ${[["auto", "Auto"], ["day", "Días"], ["week", "Semanas"], ["month", "Meses"]].map(([k, l]) => `<button type="button" data-scale="${k}" aria-pressed="${state.scale === k}">${l}</button>`).join("")}
            </div>
          </div>
        </div>
        ${all.length ? `<div class="gwrap" id="gwrap">${gantt(p, tasks)}</div>` : `<div class="empty"><h3>Sin tareas todavía</h3><p>Agrega tareas con su colaborador, fechas de inicio y fin para ver el plan en la línea de tiempo.</p><button class="btn primary" type="button" data-act="new-task">${svg("i-plus")}Agregar la primera tarea</button></div>`}
        <div class="legend">${STATUS.map(s => `<span><i class="sw" style="background:${s.color}"></i>${s.label}</span>`).join("")}<span><i class="sw" style="background:var(--today)"></i>Hoy</span><span><i class="sw" style="background:var(--danger)"></i>Contorno rojo: vencida</span></div>
      </section>

      ${all.length ? `<section class="panel">
        <div class="panel-h"><h3>Tareas del plan</h3><span class="pcount">${tasks.length} de ${all.length} mostradas${admin ? "" : " · puedes modificar las tareas asignadas a ti"}</span></div>
        <div class="twrap"><table>
          <thead><tr><th>Tarea</th><th>Colaborador</th><th>Inicio</th><th>Fin</th><th>Días</th><th>Estado</th><th><span hidden>Acciones</span></th></tr></thead>
          <tbody>${tasks.map(t => { const ed = canEditTask(t), per = personById(t.assignee_id); return `<tr>
            <td class="title">${esc(t.title)}${t.notes ? `<small title="${esc(t.notes)}">${esc(t.notes)}</small>` : ""}</td>
            <td><span class="who"><span class="avatar">${esc(initials(nameOf(t)))}</span><span>${esc(nameOf(t))}${per?.cargo ? `<small style="display:block;color:var(--muted)">${esc(per.cargo)}</small>` : ""}</span></span></td>
            <td class="mono">${fmt(t.start_date)}</td>
            <td class="mono">${fmt(t.end_date)}${isLate(t) ? ` <span class="chip late">Vencida</span>` : ""}</td>
            <td class="mono">${days(t.start_date, t.end_date)}</td>
            <td><select class="status s-${esc(t.status)}" data-status="${esc(t.id)}" aria-label="Estado de ${esc(t.title)}" ${ed ? "" : "disabled"}>${STATUS.map(s => `<option value="${s.id}"${s.id === t.status ? " selected" : ""}>${s.label}</option>`).join("")}</select></td>
            <td><div class="rowact">${ed ? `<button class="btn ghost sm" type="button" data-edit-task="${esc(t.id)}" aria-label="Editar tarea">${svg("i-edit")}</button>` : ""}${admin ? `<button class="btn ghost sm danger" type="button" data-del-task="${esc(t.id)}" aria-label="Eliminar tarea">${svg("i-trash")}</button>` : ""}</div></td>
          </tr>`; }).join("") || `<tr><td colspan="7" class="pcount">Ninguna tarea coincide con los filtros.</td></tr>`}</tbody>
        </table></div>
      </section>

      <section class="panel">
        <div class="panel-h"><h3>Carga por colaborador en este proyecto</h3><button class="btn sm" type="button" data-act="go-team">${svg("i-team")}Ver equipo</button></div>
        <div class="people">${people.map(x => {
          const ts = all.filter(t => t.assignee_id === x.key);
          return `<div class="person"><div class="person-h"><span class="avatar">${esc(initials(x.name))}</span><span>${esc(x.name)}</span><span>${ts.length} tarea${ts.length === 1 ? "" : "s"}</span></div>
            <div class="stack" role="img" aria-label="${STATUS.map(s => `${s.label}: ${ts.filter(t => t.status === s.id).length}`).join(", ")}">${STATUS.map(s => { const c = ts.filter(t => t.status === s.id).length; return c ? `<i style="width:${c / ts.length * 100}%;background:${s.color}" title="${s.label}: ${c}"></i>` : ""; }).join("")}</div>
            <div class="pcount">${STATUS.map(s => { const c = ts.filter(t => t.status === s.id).length; return c ? `${s.label} ${c}` : ""; }).filter(Boolean).join(" · ")}</div></div>`;
        }).join("")}</div>
      </section>` : ""}
    `;
    scrollToToday();
  }

  function gantt(p, tasks) {
    const pool = [p.start_date, p.end_date, ...tasks.flatMap(t => [t.start_date, t.end_date])].map(toMs).filter(n => !isNaN(n));
    if (!pool.length) return `<div class="empty"><p>Sin fechas válidas.</p></div>`;
    let min = Math.min(...pool), max = Math.max(...pool);
    const span = Math.round((max - min) / DAY) + 1;
    let scale = state.scale;
    if (scale === "auto") scale = span <= 45 ? "day" : span <= 200 ? "week" : "month";
    const dw = scale === "day" ? 32 : scale === "week" ? 12 : 4;
    const pad = scale === "day" ? 2 : scale === "week" ? 7 : 15;
    min -= pad * DAY; max += pad * DAY;
    if (scale === "week") { const wd = (new Date(min).getUTCDay() + 6) % 7; min -= wd * DAY; }
    if (scale === "month") { const d = new Date(min); min = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
    const n = Math.round((max - min) / DAY) + 1;
    const W = n * dw;
    const x = ms => Math.round((ms - min) / DAY) * dw;

    let months = "", ticks = "", cols = "";
    let d = new Date(min); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    while (d.getTime() <= max) {
      const s = Math.max(d.getTime(), min), nx = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), e = Math.min(nx, max + DAY);
      if (scale !== "month") months += `<div class="gmonth" style="left:${x(s)}px;width:${x(e) - x(s)}px">${MONTHS_L[d.getUTCMonth()]} ${d.getUTCFullYear()}</div>`;
      else { ticks += `<div class="gtick" style="left:${x(s)}px;width:${x(e) - x(s)}px">${MONTHS[d.getUTCMonth()]}</div>`; cols += `<div class="gcol" style="left:${x(s)}px;width:${x(e) - x(s)}px"></div>`; }
      d = new Date(nx);
    }
    if (scale === "month") {
      let y = new Date(min).getUTCFullYear();
      while (Date.UTC(y, 0, 1) <= max) { const s = Math.max(Date.UTC(y, 0, 1), min), e = Math.min(Date.UTC(y + 1, 0, 1), max + DAY); months += `<div class="gmonth" style="left:${x(s)}px;width:${x(e) - x(s)}px">${y}</div>`; y++; }
    }
    const tMs = toMs(todayISO());
    if (scale === "day") {
      for (let i = 0; i < n; i++) { const ms = min + i * DAY, dd = new Date(ms), we = dd.getUTCDay() === 0 || dd.getUTCDay() === 6;
        ticks += `<div class="gtick${we ? " we" : ""}${ms === tMs ? " is-today" : ""}" style="left:${i * dw}px;width:${dw}px">${dd.getUTCDate()}</div>`;
        cols += `<div class="gcol${we ? " we" : ""}" style="left:${i * dw}px;width:${dw}px"></div>`; }
    } else if (scale === "week") {
      for (let ms = min; ms <= max; ms += 7 * DAY) { const dd = new Date(ms);
        ticks += `<div class="gtick" style="left:${x(ms)}px;width:${7 * dw}px">${dd.getUTCDate()}/${dd.getUTCMonth() + 1}</div>`;
        cols += `<div class="gcol" style="left:${x(ms)}px;width:${7 * dw}px"></div>`; }
    }
    const todayLine = tMs >= min && tMs <= max ? `<div class="gtoday" style="left:${x(tMs) + Math.floor(dw / 2)}px"></div>` : "";
    const bar = t => {
      const s = toMs(t.start_date), e = toMs(t.end_date); if (isNaN(s) || isNaN(e)) return "";
      const L = x(s), Wd = Math.max(dw, x(e) + dw - L);
      return `<div class="gbar s-${esc(t.status)}${isLate(t) ? " late" : ""}" style="left:${L}px;width:${Wd}px" data-edit-task="${esc(t.id)}" title="${esc(t.title)} · ${esc(nameOf(t))} · ${fmt(t.start_date)} → ${fmt(t.end_date)} · ${ST[t.status]?.label || ""}">${Wd > 60 ? esc(ST[t.status]?.label || "") : ""}</div>`;
    };
    const ps = toMs(p.start_date), pe = toMs(p.end_date);
    return `<div class="gantt" style="width:calc(var(--lw) + ${W}px)">
      <div class="grow ghead"><div class="glabel"><span class="eyebrow">Tarea · Colaborador</span></div><div class="gscale" style="width:${W}px">${months}${ticks}</div></div>
      <div class="grow"><div class="glabel"><span class="t gproj-l">Proyecto completo</span><span class="a mono">${fmt(p.start_date)} → ${fmt(p.end_date)}</span></div>
        <div class="gtrack" style="width:${W}px"><div class="gcols">${cols}</div>${todayLine}<div class="gproj" style="left:${x(ps)}px;width:${x(pe) + dw - x(ps)}px;background:${safeColor(p.color)}"></div></div></div>
      ${tasks.map(t => `<div class="grow"><div class="glabel"><span class="t" title="${esc(t.title)}">${esc(t.title)}</span><span class="a">${esc(nameOf(t))} · <span class="mono">${days(t.start_date, t.end_date)}d</span></span></div>
        <div class="gtrack" style="width:${W}px"><div class="gcols">${cols}</div>${todayLine}${bar(t)}</div></div>`).join("")}
      ${!tasks.length ? `<div class="grow"><div class="glabel"><span class="a">Ninguna tarea coincide con los filtros.</span></div><div class="gtrack" style="width:${W}px"><div class="gcols">${cols}</div>${todayLine}</div></div>` : ""}
    </div>`;
  }

  let lastScrolledFor = "";
  function scrollToToday() {
    const wrap = $("#gwrap"); if (!wrap) return;
    const key = state.sel + "|" + state.scale;
    if (key === lastScrolledFor) return; lastScrolledFor = key;
    const line = wrap.querySelector(".gtoday"); if (!line) return;
    const lw = wrap.querySelector(".glabel").offsetWidth;
    const target = line.offsetLeft + lw - wrap.clientWidth / 2;
    if (target > 0) wrap.scrollLeft = target;
  }

  function renderTeam() {
    const admin = isAdmin();
    const visible = admin ? state.people : state.people.filter(m => m.active);
    const sorted = [...visible].sort((a, b) => (a.active === b.active ? 0 : a.active ? 1 : -1) || (a.full_name || "").localeCompare(b.full_name || ""));
    const cards = sorted.map(m => {
      const ts = state.tasks.filter(t => t.assignee_id === m.id).sort((a, b) => a.start_date.localeCompare(b.start_date));
      const open = ts.filter(t => t.status !== "finalizada");
      const late = ts.filter(isLate).length;
      const projs = new Set(ts.map(t => t.project_id)).size;
      const isMe = m.id === state.me.id;
      return `<article class="member${m.active ? "" : " pending"}">
        <div class="member-h"><span class="avatar">${esc(initials(m.full_name || m.email))}</span>
          <div style="min-width:0"><h3>${esc(m.full_name || m.email)}${isMe ? " (tú)" : ""}</h3>
            <div class="role-line" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="role ${m.active ? m.role : "inactivo"}">${m.active ? (m.role === "admin" ? "Administrador" : "Colaborador") : "Pendiente de aprobación"}</span><span class="pcount">${esc([m.cargo, m.area].filter(Boolean).join(" · "))}</span></div></div>
          <div class="rowact">${admin ? `<button class="btn ghost sm" type="button" data-edit-user="${esc(m.id)}" aria-label="Editar usuario">${svg("i-edit")}</button><button class="btn ghost sm" type="button" data-pass-user="${esc(m.id)}" aria-label="Cambiar contraseña">${svg("i-key")}</button>${isMe ? "" : `<button class="btn ghost sm danger" type="button" data-del-user="${esc(m.id)}" aria-label="Eliminar usuario">${svg("i-trash")}</button>`}` : ""}</div>
        </div>
        <div class="member-c">${m.email ? `<span>Correo: <span class="sel">${esc(m.email)}</span></span>` : ""}${m.phone ? `<span>Teléfono: <span class="sel">${esc(m.phone)}</span></span>` : ""}</div>
        ${admin && !m.active ? `<div class="member-s"><button class="btn primary sm" type="button" data-approve="${esc(m.id)}">Aprobar acceso como colaborador</button></div>` : ""}
        <div class="member-s">
          <div class="stack" role="img" aria-label="${STATUS.map(s => `${s.label}: ${ts.filter(t => t.status === s.id).length}`).join(", ")}">${ts.length ? STATUS.map(s => { const c = ts.filter(t => t.status === s.id).length; return c ? `<i style="width:${c / ts.length * 100}%;background:${s.color}" title="${s.label}: ${c}"></i>` : ""; }).join("") : ""}</div>
          <div class="pcount">${ts.length} tarea${ts.length === 1 ? "" : "s"} en ${projs} proyecto${projs === 1 ? "" : "s"} · ${open.length} abierta${open.length === 1 ? "" : "s"}${late ? ` · <span class="chip late">${late} vencida${late === 1 ? "" : "s"}</span>` : ""}</div>
        </div>
        <ul class="mtasks">${ts.length ? ts.map(t => { const p = state.projects.find(p => p.id === t.project_id); const st = ST[t.status] || ST.pendiente;
          return `<li><i class="sw" style="background:${st.color}"></i><span class="tt" title="${esc(t.title)}">${esc(t.title)}</span><span class="chip" style="color:${st.color}">${st.label}</span>
            <span class="tm">${esc(p?.name || "—")} · <span class="mono">${fmt(t.start_date)} → ${fmt(t.end_date)}</span>${isLate(t) ? ` · <span class="chip late">Vencida</span>` : ""}</span></li>`; }).join("") : `<li><span class="none" style="grid-column:1/-1">Sin tareas asignadas.</span></li>`}</ul>
      </article>`;
    }).join("");
    const pending = state.people.filter(m => !m.active).length;
    $("#view").innerHTML = `
      <section class="phead">
        <div class="phead-txt">
          <div class="eyebrow">Todos los proyectos</div>
          <h2>Equipo de trabajo</h2>
          <p>${admin ? "Crea los usuarios del equipo, define su rol y aprueba las cuentas nuevas. Aquí ves la carga de cada persona." : "Personas del equipo y su carga de trabajo en todos los proyectos."}</p>
          <div class="pfacts"><span>Usuarios activos: <b class="mono">${state.people.filter(m => m.active).length}</b></span>${admin ? `<span>Por aprobar: <b class="mono">${pending}</b></span>` : ""}<span>Tareas sin asignar: <b class="mono">${state.tasks.filter(t => !t.assignee_id).length}</b></span></div>
        </div>
        <div class="actions">${admin ? `<button class="btn primary" type="button" data-act="new-user">${svg("i-plus")}Nuevo usuario</button>` : ""}</div>
      </section>
      <section class="team">${cards}</section>`;
  }

  // ================= Diálogos =================
  const dlgP = $("#dlgProject"), dlgT = $("#dlgTask"), dlgU = $("#dlgUser"), dlgPw = $("#dlgPass"), dlgC = $("#dlgConfirm");
  document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
  $("#p-colors").innerHTML = COLORS.map((c, i) => `<label><input type="radio" name="pcolor" id="pc-${i}" value="${c}"><span style="background:${c}" title="${c}"></span></label>`).join("");
  $("#t-status").innerHTML = STATUS.map(s => `<option value="${s.id}">${s.label}</option>`).join("");

  // ---- Proyecto ----
  let editingP = null;
  function openProject(p) {
    if (p && !isAdmin()) return;
    editingP = p ? p.id : null;
    $("#dlgProjectTitle").textContent = p ? "Editar proyecto" : "Nuevo proyecto";
    const t = todayISO();
    $("#p-name").value = p?.name || ""; $("#p-owner").value = p ? p.owner_name : (state.me.full_name || ""); $("#p-client").value = p?.client || "";
    $("#p-start").value = p?.start_date || t; $("#p-end").value = p?.end_date || toISO(toMs(t) + 30 * DAY);
    $("#p-desc").value = p?.description || "";
    const c = p ? safeColor(p.color) : COLORS[state.projects.length % COLORS.length];
    document.querySelectorAll('input[name="pcolor"]').forEach(r => r.checked = r.value === c);
    $("#p-err").textContent = "";
    dlgP.showModal(); $("#p-name").focus();
  }
  $("#formProject").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("#p-name").value.trim(), start_date = $("#p-start").value, end_date = $("#p-end").value;
    if (!name) return $("#p-err").textContent = "Escribe el nombre del proyecto.";
    if (isNaN(toMs(start_date)) || isNaN(toMs(end_date))) return $("#p-err").textContent = "Indica las fechas de inicio y cierre.";
    if (toMs(end_date) < toMs(start_date)) return $("#p-err").textContent = "La fecha de cierre debe ser igual o posterior al inicio.";
    const row = { name, owner_name: $("#p-owner").value.trim(), client: $("#p-client").value.trim(), start_date, end_date,
      description: $("#p-desc").value.trim(), color: document.querySelector('input[name="pcolor"]:checked')?.value || COLORS[0] };
    $("#p-save").disabled = true;
    const q = editingP ? sb.from("projects").update(row).eq("id", editingP).select().single()
                       : sb.from("projects").insert({ ...row, created_by: state.me.id }).select().single();
    const { data, error } = await q;
    $("#p-save").disabled = false;
    if (error) return $("#p-err").textContent = errMsg(error);
    state.sel = data.id; state.view = "project"; dlgP.close();
    toast(editingP ? "Proyecto actualizado" : "Proyecto creado");
    await loadAll();
  });

  // ---- Tarea ----
  let editingT = null;
  function openTask(t) {
    const p = state.projects.find(p => p.id === state.sel); if (!p) return;
    if (t && !canEditTask(t)) return;
    editingT = t ? t.id : null;
    $("#dlgTaskTitle").textContent = t ? "Editar tarea" : "Nueva tarea";
    const sel = $("#t-assignee");
    if (isAdmin()) {
      const act = state.people.filter(m => m.active);
      sel.innerHTML = `<option value="">Sin asignar</option>` + act.map(m => `<option value="${esc(m.id)}">${esc(m.full_name || m.email)}${m.cargo ? " · " + esc(m.cargo) : ""}</option>`).join("");
      sel.value = t ? (t.assignee_id || "") : (state.fAssignee || state.me.id);
      sel.disabled = false;
    } else {
      sel.innerHTML = `<option value="${esc(state.me.id)}">${esc(state.me.full_name || state.me.email)} (tú)</option>`;
      sel.value = state.me.id; sel.disabled = true;
    }
    const today = todayISO();
    const t0 = toMs(today) >= toMs(p.start_date) && toMs(today) <= toMs(p.end_date) ? today : p.start_date;
    $("#t-title").value = t?.title || "";
    $("#t-status").value = t?.status || "pendiente";
    $("#t-start").value = t?.start_date || t0; $("#t-end").value = t?.end_date || toISO(Math.min(toMs(t0) + 6 * DAY, toMs(p.end_date)));
    $("#t-notes").value = t?.notes || ""; $("#t-err").textContent = "";
    dlgT.showModal(); $("#t-title").focus();
  }
  $("#formTask").addEventListener("submit", async e => {
    e.preventDefault();
    const title = $("#t-title").value.trim(), start_date = $("#t-start").value, end_date = $("#t-end").value;
    if (!title) return $("#t-err").textContent = "Escribe el nombre de la tarea.";
    if (isNaN(toMs(start_date)) || isNaN(toMs(end_date))) return $("#t-err").textContent = "Indica las fechas de inicio y fin.";
    if (toMs(end_date) < toMs(start_date)) return $("#t-err").textContent = "La fecha de fin debe ser igual o posterior al inicio.";
    const assignee_id = isAdmin() ? ($("#t-assignee").value || null) : state.me.id;
    const row = { title, assignee_id, start_date, end_date, status: $("#t-status").value, notes: $("#t-notes").value.trim() };
    $("#t-save").disabled = true;
    const q = editingT ? sb.from("tasks").update(row).eq("id", editingT).select()
                       : sb.from("tasks").insert({ ...row, project_id: state.sel, created_by: state.me.id }).select();
    const { data, error } = await q;
    $("#t-save").disabled = false;
    if (error) return $("#t-err").textContent = errMsg(error);
    if (!data || !data.length) return $("#t-err").textContent = "No tienes permiso para modificar esta tarea.";
    dlgT.close(); toast(editingT ? "Tarea actualizada" : "Tarea agregada");
    await loadAll();
  });

  // ---- Usuario (solo admin) ----
  let editingU = null;
  function openUser(m) {
    if (!isAdmin()) return;
    editingU = m ? m.id : null;
    $("#dlgUserTitle").textContent = m ? "Editar usuario" : "Nuevo usuario";
    $("#u-email-wrap").hidden = !!m; $("#u-pass-wrap").hidden = !!m; $("#u-active-wrap").hidden = !m;
    $("#u-name").value = m?.full_name || ""; $("#u-email").value = ""; $("#u-pass").value = "";
    $("#u-role").value = m?.role || "colaborador"; $("#u-cargo").value = m?.cargo || ""; $("#u-area").value = m?.area || ""; $("#u-phone").value = m?.phone || "";
    $("#u-active").checked = m ? !!m.active : true;
    $("#u-err").textContent = "";
    dlgU.showModal(); $("#u-name").focus();
  }
  async function callAdmin(body) {
    const { data, error } = await sb.functions.invoke("admin-users", { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }
  $("#formUser").addEventListener("submit", async e => {
    e.preventDefault();
    const full_name = $("#u-name").value.trim();
    if (!full_name) return $("#u-err").textContent = "Escribe el nombre.";
    const fields = { full_name, role: $("#u-role").value, cargo: $("#u-cargo").value.trim(), area: $("#u-area").value.trim(), phone: $("#u-phone").value.trim() };
    $("#u-save").disabled = true; $("#u-err").textContent = "";
    try {
      if (editingU) {
        const { error } = await sb.from("profiles").update({ ...fields, active: $("#u-active").checked }).eq("id", editingU);
        if (error) throw error;
        toast("Usuario actualizado");
      } else {
        const email = $("#u-email").value.trim(), password = $("#u-pass").value;
        if (!validEmail(email)) throw new Error("Revisa el correo del usuario.");
        if (password.length < 8) throw new Error("La contraseña temporal debe tener al menos 8 caracteres.");
        await callAdmin({ action: "create", email, password, ...fields });
        toast("Usuario creado. Comparte el correo y la contraseña temporal con la persona.");
      }
      dlgU.close(); await loadAll();
    } catch (err) { $("#u-err").textContent = errMsg(err); }
    finally { $("#u-save").disabled = false; }
  });

  // ---- Contraseña ----
  let passFor = null;
  function openPass(m) {
    passFor = m ? m.id : null;
    $("#dlgPassTitle").textContent = m && m.id !== state.me.id ? `Nueva contraseña para ${m.full_name || m.email}` : "Cambiar mi contraseña";
    $("#pw-new").value = ""; $("#pw-err").textContent = "";
    dlgPw.showModal(); $("#pw-new").focus();
  }
  $("#btnMyPass").addEventListener("click", () => openPass(null));
  $("#formPass").addEventListener("submit", async e => {
    e.preventDefault();
    const password = $("#pw-new").value;
    if (password.length < 8) return $("#pw-err").textContent = "La contraseña debe tener al menos 8 caracteres.";
    $("#pw-save").disabled = true;
    try {
      if (!passFor || passFor === state.me.id) { const { error } = await sb.auth.updateUser({ password }); if (error) throw error; }
      else await callAdmin({ action: "set_password", id: passFor, password });
      dlgPw.close(); toast("Contraseña actualizada");
    } catch (err) { $("#pw-err").textContent = errMsg(err); }
    finally { $("#pw-save").disabled = false; }
  });

  // ---- Confirmación ----
  let confirmFn = null;
  function confirmDel(title, msg, fn) { $("#c-title").textContent = title; $("#c-msg").textContent = msg; confirmFn = fn; dlgC.showModal(); }
  $("#c-ok").addEventListener("click", async () => {
    const fn = confirmFn; confirmFn = null; $("#c-ok").disabled = true;
    try { await fn(); } catch (err) { toast(errMsg(err)); }
    finally { $("#c-ok").disabled = false; dlgC.close(); await loadAll(); }
  });

  // ================= Eventos =================
  $("#btnNewProject").addEventListener("click", () => openProject(null));
  $("#btnTeam").addEventListener("click", () => { state.view = "team"; render(); });
  $("#plist").addEventListener("click", e => { const b = e.target.closest("[data-pid]"); if (!b) return; state.view = "project"; state.sel = b.dataset.pid; state.fAssignee = ""; state.fStatus = ""; render(); });

  $("#view").addEventListener("click", async e => {
    const p = state.projects.find(p => p.id === state.sel);
    const a = e.target.closest("[data-act]");
    if (a) {
      const act = a.dataset.act;
      if (act === "new-project") openProject(null);
      if (act === "new-task") openTask(null);
      if (act === "new-user") openUser(null);
      if (act === "go-team") { state.view = "team"; render(); window.scrollTo(0, 0); }
      if (act === "edit-project" && p) openProject(p);
      if (act === "del-project" && p && isAdmin()) { const n = projTasks(p.id).length;
        confirmDel("Eliminar proyecto", `Se eliminará “${p.name}” y sus ${n} tarea${n === 1 ? "" : "s"}. Esta acción no se puede deshacer.`, async () => {
          const { error } = await sb.from("projects").delete().eq("id", p.id); if (error) throw error; toast("Proyecto eliminado"); }); }
      return;
    }
    const s = e.target.closest("[data-scale]"); if (s) { state.scale = s.dataset.scale; render(); return; }
    const et = e.target.closest("[data-edit-task]"); if (et) { const t = state.tasks.find(t => t.id === et.dataset.editTask); if (t && canEditTask(t)) openTask(t); else if (t) toast("Solo puedes modificar las tareas asignadas a ti."); return; }
    const dt = e.target.closest("[data-del-task]"); if (dt && isAdmin()) { const t = state.tasks.find(t => t.id === dt.dataset.delTask);
      if (t) confirmDel("Eliminar tarea", `Se eliminará la tarea “${t.title}”. Esta acción no se puede deshacer.`, async () => {
        const { error } = await sb.from("tasks").delete().eq("id", t.id); if (error) throw error; toast("Tarea eliminada"); }); return; }
    const eu = e.target.closest("[data-edit-user]"); if (eu) { openUser(personById(eu.dataset.editUser)); return; }
    const pu = e.target.closest("[data-pass-user]"); if (pu) { openPass(personById(pu.dataset.passUser)); return; }
    const du = e.target.closest("[data-del-user]"); if (du) { const m = personById(du.dataset.delUser);
      if (m) { const n = state.tasks.filter(t => t.assignee_id === m.id).length;
        confirmDel("Eliminar usuario", `Se eliminará la cuenta de “${m.full_name || m.email}”; ya no podrá iniciar sesión.${n ? ` Sus ${n} tarea${n === 1 ? "" : "s"} quedarán sin asignar.` : ""} Esta acción no se puede deshacer.`, async () => {
          await callAdmin({ action: "delete", id: m.id }); toast("Usuario eliminado"); }); }
      return; }
    const ap = e.target.closest("[data-approve]"); if (ap) {
      ap.disabled = true;
      const { error } = await sb.from("profiles").update({ active: true, role: "colaborador" }).eq("id", ap.dataset.approve);
      if (error) { toast(errMsg(error)); ap.disabled = false; } else { toast("Acceso aprobado"); await loadAll(); }
    }
  });

  $("#view").addEventListener("change", async e => {
    if (e.target.id === "fAssignee") { state.fAssignee = e.target.value; render(); return; }
    if (e.target.id === "fStatus") { state.fStatus = e.target.value; render(); return; }
    const sel = e.target.closest("[data-status]");
    if (sel) {
      const id = sel.dataset.status, v = sel.value; sel.className = "status s-" + v;
      const { data, error } = await sb.from("tasks").update({ status: v }).eq("id", id).select("id");
      if (error || !data || !data.length) { toast(error ? errMsg(error) : "No tienes permiso para modificar esta tarea."); }
      else toast(`Estado: ${ST[v].label}`);
      await loadAll();
    }
  });
})();
