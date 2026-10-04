/* ERP shared date/time controls.
   Hidden inputs hold the value and fire a bubbling "change" event:
   - data-dtp  : date + time, value is an ISO timestamp (or "" when cleared)
   - data-dp   : date only, value is YYYY-MM-DD
   - data-slots: training slot, value is the slot key (e.g. "09:00-12:00")
   Existing change listeners keep working without changes. */
(function () {
  const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];
  const WEEK = ["B.e", "Ç.a", "Ç", "C.a", "C", "Ş", "B"];
  const TIMES = [];
  for (let h = 9; h <= 21; h++) {
    TIMES.push(`${pad(h)}:00`);
    if (h < 21) TIMES.push(`${pad(h)}:30`);
  }
  const TRAINING_SLOTS = [
    { key: "09:00-12:00", label: "09:00–12:00" },
    { key: "12:00-15:00", label: "12:00–15:00" },
    { key: "15:00-18:00", label: "15:00–18:00" },
  ];
  const OTHER = "__other__";
  const openPops = new Set();

  const STYLE = `
    .dtp { display:inline-flex; gap:6px; align-items:center; position:relative; }
    .dp { position:relative; display:inline-flex; align-items:center; }
    .dp-input { width:96px; height:28px; padding:0 8px; border:1px solid #dfe7ea; border-radius:7px; font-size:12px; background:#fff; }
    .dp-input:focus, .ts:focus, .ts-input:focus { outline:none; border-color:#ff6800; box-shadow:0 0 0 2px #ff680022; }
    .dp-btn { margin-left:4px; height:28px; width:28px; border:1px solid #dfe7ea; border-radius:7px; background:#fff; cursor:pointer; font-size:13px; padding:0; color:#17232b; }
    .dp-pop { position:fixed; z-index:1000; background:#fff; border:1px solid #dfe7ea; border-radius:12px; box-shadow:0 8px 20px #0002; padding:8px; width:226px; font-size:12px; }
    .dp-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; font-weight:700; color:#17232b; }
    .dp-head button { background:none; border:0; cursor:pointer; font-size:14px; padding:2px 6px; color:#17232b; width:auto; }
    .dp-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; text-align:center; }
    .dp-wd { color:#6d7b83; font-size:10px; font-weight:700; padding:2px 0; }
    .dp-day { height:26px; border:0; border-radius:6px; background:none; cursor:pointer; font-size:12px; color:#17232b; padding:0; width:auto; }
    .dp-day:hover { background:#fff1e6; }
    .dp-day.today { box-shadow:inset 0 0 0 1px #ff6800; }
    .dp-day.sel { background:#ff6800; color:#fff; font-weight:700; }
    .dp-foot { display:flex; justify-content:space-between; margin-top:6px; }
    .dp-foot button { background:none; border:0; color:#ff6800; font-weight:700; cursor:pointer; font-size:12px; padding:2px 4px; width:auto; }
    .ts { height:28px; padding:0 6px; border:1px solid #dfe7ea; border-radius:7px; font-size:12px; background:#fff; width:84px; }
    .ts-input { width:70px; height:28px; padding:0 6px; border:1px solid #dfe7ea; border-radius:7px; font-size:12px; }
    .slots { display:inline-flex; border:1px solid #dfe7ea; border-radius:8px; overflow:hidden; }
    .slots button { border:0; border-right:1px solid #dfe7ea; background:#fff; padding:5px 10px; font-size:12px; cursor:pointer; color:#17232b; width:auto; }
    .slots button:last-child { border-right:0; }
    .slots button.sel { background:#ff6800; color:#fff; font-weight:700; }
  `;

  function injectStyle() {
    if (document.getElementById("erp-dt-style")) return;
    const st = document.createElement("style");
    st.id = "erp-dt-style";
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  function pad(n) { return String(n).padStart(2, "0"); }
  function ymdOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function dmy(s) { return s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : ""; }
  function parseDmy(text) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((text || "").trim());
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 ? ymdOf(d) : null;
  }
  function splitIso(value) {
    if (!value) return { date: "", time: "" };
    const d = new Date(value);
    if (isNaN(d)) return { date: "", time: "" };
    return { date: ymdOf(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
  function composeIso(date, time) {
    if (!date) return "";
    return new Date(`${date}T${time || "09:00"}`).toISOString();
  }
  function emit(input, value) {
    input.value = value || "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function wrapInput(input) {
    const host = document.createElement("span");
    host.className = "dtp";
    input.parentNode.insertBefore(host, input);
    host.appendChild(input);
    input.hidden = true;
    return host;
  }

  function buildDate(slot, opts) {
    let selected = opts.value || "";
    let view = (selected || ymdOf(new Date())).slice(0, 7);
    slot.classList.add("dp");
    slot.innerHTML = `
      <input class="dp-input" placeholder="gg.aa.iiii" value="${dmy(selected)}">
      <button type="button" class="dp-btn" aria-label="Təqvim">📅</button>
    `;
    const textEl = slot.querySelector(".dp-input");
    const btn = slot.querySelector(".dp-btn");
    const pop = document.createElement("div");
    pop.className = "dp-pop";
    if (opts.disabled) { textEl.disabled = true; btn.disabled = true; }

    function renderPop() {
      const [y, m] = view.split("-").map(Number);
      const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
      const days = new Date(y, m, 0).getDate();
      const today = ymdOf(new Date());
      let cells = "";
      for (let i = 0; i < offset; i++) cells += "<span></span>";
      for (let d = 1; d <= days; d++) {
        const ds = `${y}-${pad(m)}-${pad(d)}`;
        cells += `<button type="button" class="dp-day${ds === selected ? " sel" : ""}${ds === today ? " today" : ""}" data-day="${ds}">${d}</button>`;
      }
      pop.innerHTML = `
        <div class="dp-head"><button type="button" data-nav="-1">‹</button><span>${MONTHS[m - 1]} ${y}</span><button type="button" data-nav="1">›</button></div>
        <div class="dp-grid">${WEEK.map(w => `<span class="dp-wd">${w}</span>`).join("")}${cells}</div>
        <div class="dp-foot"><button type="button" data-today="1">Bu gün</button><button type="button" data-clear="1">Təmizlə</button></div>`;
    }

    const entry = { host: slot, pop: pop, close: null };
    function close() {
      if (pop.parentNode) pop.parentNode.removeChild(pop);
      openPops.delete(entry);
    }
    entry.close = close;
    function place() {
      const r = btn.getBoundingClientRect();
      const height = 230;
      const below = window.innerHeight - r.bottom;
      pop.style.left = Math.min(r.left, window.innerWidth - 240) + "px";
      pop.style.top = (below < height && r.top > height ? r.top - height - 4 : r.bottom + 4) + "px";
    }
    function open() {
      [...openPops].forEach(p => p.close());
      renderPop();
      document.body.appendChild(pop);
      place();
      openPops.add(entry);
    }
    function pick(ds) {
      selected = ds;
      textEl.value = dmy(ds);
      close();
      opts.onPick(ds);
    }

    btn.addEventListener("click", e => { e.stopPropagation(); if (pop.parentNode) close(); else open(); });
    pop.addEventListener("click", e => {
      const t = e.target;
      if (t.dataset.nav) {
        const [y, m] = view.split("-").map(Number);
        view = ymdOf(new Date(y, m - 1 + Number(t.dataset.nav), 1)).slice(0, 7);
        renderPop();
      } else if (t.dataset.day) {
        pick(t.dataset.day);
      } else if (t.dataset.today) {
        pick(ymdOf(new Date()));
      } else if (t.dataset.clear) {
        pick("");
      }
    });
    textEl.addEventListener("change", () => {
      const raw = textEl.value.trim();
      const parsed = raw === "" ? "" : parseDmy(raw);
      if (parsed === null) { textEl.value = dmy(selected); return; }
      selected = parsed;
      view = (parsed || view).slice(0, 7);
      opts.onPick(parsed);
    });

    return { setValue(ds) { selected = ds || ""; textEl.value = dmy(selected); } };
  }

  function buildTime(slot, opts) {
    let current = opts.value || "";
    const options = current && !TIMES.includes(current) ? [current, ...TIMES] : TIMES;
    slot.classList.add("ts-wrap");
    slot.innerHTML = `
      <select class="ts">
        <option value="" ${!current ? "selected" : ""}>—</option>
        ${options.map(t => `<option value="${t}" ${t === current ? "selected" : ""}>${t}</option>`).join("")}
        <option value="${OTHER}">Başqa saat...</option>
      </select>
      <input class="ts-input" placeholder="SS:DD" hidden>`;
    const sel = slot.querySelector(".ts");
    const txt = slot.querySelector(".ts-input");
    if (opts.disabled) sel.disabled = true;

    sel.addEventListener("change", () => {
      if (sel.value === OTHER) {
        sel.hidden = true;
        txt.hidden = false;
        txt.value = current;
        txt.focus();
        return;
      }
      current = sel.value;
      opts.onPick(current);
    });
    txt.addEventListener("change", () => {
      const v = txt.value.trim();
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
        current = v;
        txt.hidden = true;
        sel.hidden = false;
        opts.onPick(v);
      } else {
        txt.value = current;
      }
    });

    return {
      setValue(hm) {
        current = hm || "";
        if (current && ![...sel.options].some(o => o.value === current)) {
          sel.insertBefore(new Option(current, current), sel.lastElementChild);
        }
        sel.value = current;
      },
    };
  }

  function mountDateTime(input) {
    if (input._erp) return input._erp;
    injectStyle();
    const host = wrapInput(input);
    const dateSlot = document.createElement("span");
    const timeSlot = document.createElement("span");
    host.append(dateSlot, timeSlot);
    let state = splitIso(input.value);
    const commit = () => emit(input, state.date ? composeIso(state.date, state.time) : "");
    const dp = buildDate(dateSlot, {
      value: state.date,
      disabled: input.disabled,
      onPick: d => {
        state.date = d;
        if (d && !state.time) { state.time = "09:00"; tp.setValue(state.time); }
        commit();
      },
    });
    const tp = buildTime(timeSlot, {
      value: state.time,
      disabled: input.disabled,
      onPick: t => {
        state.time = t;
        if (!state.date) { state.date = ymdOf(new Date()); dp.setValue(state.date); }
        commit();
      },
    });
    input._erp = {
      refresh() {
        state = splitIso(input.value);
        dp.setValue(state.date);
        tp.setValue(state.time);
      },
    };
    return input._erp;
  }

  function mountDate(input) {
    if (input._erp) return input._erp;
    injectStyle();
    const host = wrapInput(input);
    const slot = document.createElement("span");
    host.appendChild(slot);
    const dp = buildDate(slot, {
      value: input.value,
      disabled: input.disabled,
      onPick: d => emit(input, d),
    });
    input._erp = { refresh() { dp.setValue(input.value); } };
    return input._erp;
  }

  function mountSlots(input) {
    if (input._erp) return input._erp;
    injectStyle();
    const host = wrapInput(input);
    const seg = document.createElement("span");
    seg.className = "slots";
    seg.innerHTML = TRAINING_SLOTS.map(s => `<button type="button" data-key="${s.key}" class="${s.key === input.value ? "sel" : ""}">${s.label}</button>`).join("");
    host.appendChild(seg);
    seg.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      seg.querySelectorAll("button").forEach(x => x.classList.toggle("sel", x === b));
      emit(input, b.dataset.key);
    });
    input._erp = {
      refresh() { seg.querySelectorAll("button").forEach(x => x.classList.toggle("sel", x.dataset.key === input.value)); },
    };
    return input._erp;
  }

  function mountAll(root) {
    const scope = root || document;
    scope.querySelectorAll("input[data-dtp]").forEach(mountDateTime);
    scope.querySelectorAll("input[data-dp]").forEach(mountDate);
    scope.querySelectorAll("input[data-slots]").forEach(mountSlots);
  }

  function refresh(input) {
    if (input && input._erp) input._erp.refresh();
  }

  document.addEventListener("click", e => {
    [...openPops].forEach(p => {
      if (!p.host.contains(e.target) && !p.pop.contains(e.target)) p.close();
    });
  });
  window.addEventListener("scroll", () => [...openPops].forEach(p => p.close()), true);
  window.addEventListener("resize", () => [...openPops].forEach(p => p.close()));

  window.ERP = { mountAll, refresh, TRAINING_SLOTS };
})();
