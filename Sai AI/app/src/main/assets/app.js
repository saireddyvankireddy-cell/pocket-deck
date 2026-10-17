"use strict";
const $ = (s, r = document) => r.querySelector(s);
const h = (t, a = {}, ...k) => { const e = document.createElement(t); for (const x in a) { const v = a[x]; if (v == null || v === false) continue; if (x === "class") e.className = v; else if (x === "html") e.innerHTML = v; else if (x.startsWith("on")) e.addEventListener(x.slice(2), v); else if (x === "checked") e.checked = !!v; else if (x === "value") e.value = v; else e.setAttribute(x, v); } for (const c of k.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); return e; };
const pending = new Map(); let seq = 0;
function native(action, body) { return new Promise((res, rej) => { const id = String(++seq); pending.set(id, { res, rej }); try { window.SaiNative.request(id, action, JSON.stringify(body || {})); } catch (e) { pending.delete(id); rej(e); } setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error("timeout")); } }, 300000); }); }
window.saiNativeReply = (id, payload) => { const p = pending.get(String(id)); if (!p) return; pending.delete(String(id)); try { const o = JSON.parse(payload); if (o.status >= 200 && o.status < 300) p.res(o.data); else p.rej(new Error((o.data && o.data.error) || "Request failed")); } catch (e) { p.rej(e); } };
function toast(m) { const t = $(".toast") || h("div", { class: "toast" }); t.textContent = m; document.body.append(t); requestAnimationFrame(() => t.classList.add("on")); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("on"), 2400); }
const fmtBytes = b => { b = Number(b) || 0; const g = b / 1e9; return g >= 1 ? g.toFixed(1) + " GB" : (b / 1e6).toFixed(0) + " MB"; };
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

let state = { models: [], active: null, systemPrompt: "", temperature: 0.7, hasHfToken: false, provider: { baseUrl: "", model: "", hasKey: false }, engine: {}, photoPermission: false, saiphotos: false, pcloud: false, version: "1.0.1" };
let tab = "chat", mode = localStorage.getItem("sai-mode") || "local";
let agentMode = localStorage.getItem("sai-agent") !== "0";
let confirmDestructive = localStorage.getItem("sai-confirm") !== "0";
let sessions = JSON.parse(localStorage.getItem("sai-sessions") || "[]");
let currentId = localStorage.getItem("sai-current") || null;

function current() { let s = sessions.find(x => x.id === currentId); if (!s) { s = { id: "s" + Date.now(), title: "New chat", messages: [], api: [] }; sessions.unshift(s); currentId = s.id; saveSessions(); } return s; }
function saveSessions() { localStorage.setItem("sai-sessions", JSON.stringify(sessions.slice(0, 40))); localStorage.setItem("sai-current", currentId || ""); }
function newChat() { const s = { id: "s" + Date.now(), title: "New chat", messages: [], api: [] }; sessions.unshift(s); currentId = s.id; saveSessions(); renderChat(); }

const TOOLS = [
  { type: "function", function: { name: "list_photos", description: "List or search the user's device photos. Returns newest first.", parameters: { type: "object", properties: { query: { type: "string", description: "Optional text to match in file names" }, album: { type: "string", description: "Optional album/folder name" }, limit: { type: "integer", description: "Max photos to return (1-200, default 20)" } } } } },
  { type: "function", function: { name: "photo_info", description: "Get details about one photo by id.", parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } } },
  { type: "function", function: { name: "list_albums", description: "List the user's photo albums with counts.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "open_photo", description: "Open a photo in the device gallery viewer.", parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } } },
  { type: "function", function: { name: "share_photo", description: "Open the Android share sheet for a photo.", parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } } },
  { type: "function", function: { name: "set_wallpaper", description: "Set a photo as the device wallpaper.", parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } } },
  { type: "function", function: { name: "delete_photos", description: "Delete photos from the device. Android will ask the user to confirm.", parameters: { type: "object", properties: { ids: { type: "array", items: { type: "integer" } } }, required: ["ids"] } } },
  { type: "function", function: { name: "copy_photos_to_album", description: "Copy photos into an album (folder) under Pictures.", parameters: { type: "object", properties: { ids: { type: "array", items: { type: "integer" } }, album: { type: "string" } }, required: ["ids", "album"] } } },
  { type: "function", function: { name: "open_sai_photos", description: "Launch the Sai Photos app if installed.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "search_pcloud_photos", description: "Search the user's pCloud cloud photo library by file name or folder. Use for cloud photos, not device photos.", parameters: { type: "object", properties: { query: { type: "string", description: "Text to match in file names or folders" }, limit: { type: "integer", description: "Max results (1-200, default 30)" } } } } },
  { type: "function", function: { name: "open_in_saiphotos", description: "Open the Sai Photos app to a specific view: albums, favorites, search (with q), an album by name, a person, or a photo by its pc- id.", parameters: { type: "object", properties: { view: { type: "string", description: "albums, favorites, photos or search" }, q: { type: "string" }, album: { type: "string" }, person: { type: "string" }, photo: { type: "string", description: "Photo id like pc-123" } } } } }
];
const DESTRUCTIVE = new Set(["delete_photos", "copy_photos_to_album", "set_wallpaper"]);
const PCLOUD_TOOLS = new Set(["search_pcloud_photos", "open_in_saiphotos"]);
const TOOL_LABEL = { list_photos: "Lists your photos", photo_info: "Reads a photo's details", list_albums: "Lists your albums", open_photo: "Opens a photo", share_photo: "Shares a photo", set_wallpaper: "Sets your wallpaper", delete_photos: "Deletes photos", copy_photos_to_album: "Copies photos into an album", open_sai_photos: "Opens Sai Photos", search_pcloud_photos: "Searches your pCloud photos", open_in_saiphotos: "Opens Sai Photos" };
function describe(call) { const a = call.args || {}; if (call.name === "delete_photos") return `delete ${(a.ids || []).length} photo(s)`; if (call.name === "copy_photos_to_album") return `copy ${(a.ids || []).length} photo(s) into “${a.album}”`; if (call.name === "set_wallpaper") return `set photo #${a.id} as wallpaper`; return TOOL_LABEL[call.name] || call.name; }

function ask(title, body) { return new Promise(res => { const d = $("#confirm"); $("#confirmTitle").textContent = title; $("#confirmBody").textContent = body; d.showModal(); const done = v => { d.close(); $("#confirmYes").onclick = null; $("#confirmNo").onclick = null; res(v); }; $("#confirmYes").onclick = () => done(true); $("#confirmNo").onclick = () => done(false); d.oncancel = () => done(false); }); }

// ---------------- events from native ----------------
let streamEl = null, streamText = "";
window.saiAIEvent = ev => {
  if (ev.type === "chat-chunk") { streamText += ev.text || ""; if (streamEl) { streamEl.textContent = streamText; streamEl.classList.add("typing"); scroll(); } }
  else if (ev.type === "chat-done") { finishStream(); }
  else if (ev.type === "chat-error") { if (streamEl) { streamEl.textContent = "⚠️ " + ev.error; streamEl.classList.remove("typing"); } else toast(ev.error); streamEl = null; }
  else if (ev.type === "engine") { engineEvent(ev); }
  else if (ev.type === "download") { onDownload(ev.payload); }
  else if (ev.type === "pcloud") { if (ev.state === "connected") toast("pCloud connected"); else if (ev.state === "error") toast(ev.error || "pCloud login failed"); refreshState().then(() => { if (tab === "photos") renderPhotos(); }); }
};
function finishStream() { if (streamEl) { streamEl.classList.remove("typing"); const s = current(); if (!streamText.trim()) { streamEl.textContent = "⚠️ The model returned no text. Open Models and tap Activate again, or try a different model."; } else { s.messages.push({ role: "ai", text: streamText }); saveSessions(); } } streamEl = null; streamText = ""; }
function engineEvent(ev) { refreshState(); if (ev.state === "ready") toast("Model ready — chat offline now."); else if (ev.state === "error") toast("Model error: " + (ev.error || "unknown")); }
function onDownload(p) { const t = current(); const onModels = tab === "models"; refreshState().then(() => { if (onModels) renderModels(); }); const m = state.models.find(x => x.id === p.id); if (p.done) toast((m ? m.name : p.id) + " downloaded"); else if (p.state && p.state.error) toast("Download failed: " + p.state.error); }

// ---------------- chat ----------------
const view = () => $("#view");
function setSection(name, kids) { let el = document.getElementById("sec-" + name); if (!el) { el = h("section", { id: "sec-" + name }); view().append(el); } el.textContent = ""; kids.filter(Boolean).forEach(k => el.append(k)); el.classList.toggle("on", tab === name); return el; }
function scroll() { const m = $("#mainScroll"); if (m) m.scrollTop = m.scrollHeight; }

function renderChat() {
  const s = current();
  const box = h("div", { id: "chat" });
  if (!s.messages.length) box.append(h("div", { class: "msg ai" }, "Hi, I'm Sai. Ask me anything — I can also work with your photos once Agent mode and a model are ready."));
  for (const m of s.messages) {
    if (m.role === "tool") box.append(h("div", { class: "tool", html: m.html }));
    else box.append(h("div", { class: "msg " + (m.role === "user" ? "user" : "ai") }, m.text));
  }
  const mainEl = h("div", { id: "mainScroll", style: "display:flex;flex-direction:column" }, box);
  setSection("chat", [mainEl]);
  scroll();
}

function addMsg(role, text) { const s = current(); s.messages.push({ role, text }); if (role === "user" && s.title === "New chat") { s.title = text.slice(0, 28); } saveSessions(); renderChat(); }

async function send() {
  const box = $("#composer"); const text = box.value.trim(); if (!text) return; box.value = "";
  addMsg("user", text);
  const s = current(); s.api.push({ role: "user", content: text });
  if (mode === "cloud") { await cloudReply(); } else { await localReply(text); }
}

async function localReply(text) {
  const s = current();
  streamText = ""; streamEl = null;
  // append a placeholder bubble
  const box = $("#chat"); const bubble = h("div", { class: "msg ai typing" }); box.append(bubble); streamEl = bubble; scroll();
  try { await native("chat", { prompt: text }); } catch (e) { bubble.textContent = "⚠️ " + e.message; bubble.classList.remove("typing"); streamEl = null; }
}

async function cloudReply() {
  const s = current();
  const box = $("#chat");
  for (let step = 0; step < 8; step++) {
    let res;
    try { res = await native("cloud-chat", { messages: s.api, tools: agentMode ? TOOLS : null, temperature: state.temperature }); }
    catch (e) { box.append(h("div", { class: "msg ai" }, "⚠️ " + e.message)); return; }
    if (res.error) { box.append(h("div", { class: "msg ai" }, "⚠️ " + res.error)); return; }
    const calls = res.toolCalls || [];
    if (res.content) { const b = h("div", { class: "msg ai" }, res.content); box.append(b); s.messages.push({ role: "ai", text: res.content }); scroll(); }
    if (!calls.length) { saveSessions(); return; }
    const assistant = { role: "assistant", content: res.content || "" , tool_calls: calls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) };
    s.api.push(assistant);
    for (const call of calls) {
      const action = PCLOUD_TOOLS.has(call.name) ? "pcloud-tool" : "tool-run";
      let result;
      if (DESTRUCTIVE.has(call.name) && confirmDestructive) {
        const ok = await ask("Allow this action?", `Sai wants to ${describe(call)}.`);
        result = ok ? await native(action, { name: call.name, args: call.args }) : { error: "The user declined this action." };
      } else { result = await native(action, { name: call.name, args: call.args }); }
      const html = `<b>${TOOL_LABEL[call.name] || call.name}</b><br>${escapeHtml(previewResult(call.name, result))}`;
      box.append(h("div", { class: "tool", html })); s.messages.push({ role: "tool", html }); scroll();
      s.api.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
    saveSessions();
  }
}
function previewResult(name, r) {
  if (r.error) return "⚠️ " + r.error;
  if (name === "list_photos") return `${r.count || 0} photo(s): ` + (r.items || []).slice(0, 4).map(p => p.name).join(", ");
  if (name === "list_albums") return (r.albums || []).slice(0, 6).map(a => `${a.album} (${a.count})`).join(", ");
  if (name === "delete_photos") return r.confirm ? "Android confirmation shown." : `deleted ${r.deleted}`;
  if (name === "copy_photos_to_album") return `copied ${r.copied} into ${r.album}`;
  if (name === "search_pcloud_photos") return `${r.count || 0} pCloud match(es): ` + (r.items || []).slice(0, 4).map(p => p.name).join(", ");
  if (name === "open_in_saiphotos") return r.opened ? "Opened Sai Photos." : "Sai Photos could not be opened.";
  return JSON.stringify(r).slice(0, 160);
}
function escapeHtml(t) { return String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ---------------- models ----------------
function renderModels() {
  const kids = [];
  const active = state.active;
  const card = h("div", { class: "card" }, h("h3", {}, "On-device models"), h("p", { class: "note", style: "margin-top:0" }, "Downloaded models run fully offline on this phone. " + (active ? "Active: " + (state.models.find(m => m.id === active) || {}).name : "None active yet.")));
  kids.push(card);
  for (const m of state.models) {
    const dl = m.download || {};
    const running = dl.running && !dl.done;
    const pct = dl.total ? Math.min(100, Math.round((dl.bytes / dl.total) * 100)) : 0;
    const item = h("div", { class: "card" },
      h("div", { class: "row" }, h("div", { class: "grow", style: "min-width:0" }, h("b", {}, m.name), h("small", { class: "dim" }, `${fmtBytes(m.sizeBytes)} · ${m.license}${m.gated ? " · needs HF token" : ""}`)), m.active ? h("span", { class: "pill active" }, "Active") : (m.downloaded ? h("span", { class: "pill" }, "Ready") : null)),
      h("div", { class: "dim", style: "font-size:13px;margin-top:6px" }, m.note),
      running ? h("div", { class: "bar" }, h("i", { style: `width:${pct}%` })) : null,
      h("div", { class: "actions" },
        running ? h("button", { class: "ghost", onclick: () => native("cancel-download", { id: m.id }).then(renderModels) }, "Cancel")
          : m.downloaded ? h("button", { onclick: () => activate(m.id) }, m.active ? "Reload" : "Use")
            : h("button", { class: "primary", onclick: () => download(m) }, "Download"),
        m.downloaded ? h("button", { class: "ghost", onclick: () => native("delete-model", { id: m.id }).then(r => { state = r; renderModels(); }) }, "Delete") : null,
        m.gated ? h("button", { class: "ghost", onclick: () => native("open-url", { url: "https://huggingface.co/litert-community/" + (m.id === "gemma3-1b" ? "Gemma3-1B-IT" : "gemma-4-E2B-it-litert-lm") }) }, "Page") : null));
    kids.push(item);
  }
  kids.push(h("div", { class: "card" }, h("h3", {}, "Hugging Face token"), h("p", { class: "note", style: "margin-top:0" }, "Only needed for gated models like Gemma 3 1B. Create a free read token on Hugging Face and accept the model's license first."),
    h("div", { class: "field" }, h("input", { type: "password", id: "hfToken", placeholder: state.hasHfToken ? "Token saved" : "hf_…" })),
    h("div", { class: "actions" }, h("button", { onclick: () => native("hf-token-save", { token: $("#hfToken").value }).then(r => { state = r; toast("Token saved"); renderModels(); }) }, "Save token"))));
  setSection("models", kids);
}
function download(m) { native("download", { id: m.id }).then(() => { toast("Downloading " + m.name); refreshState().then(renderModels); }).catch(e => toast(e.message)); }
function activate(id) { native("activate", { id }).then(() => { toast("Loading model…"); refreshState().then(renderModels); }).catch(e => toast(e.message)); }

// ---------------- agent ----------------
function renderAgent() {
  const kids = [];
  const toggle = (on, fn) => h("label", { class: "pill", style: "cursor:pointer" }, h("input", { type: "checkbox", checked: on, style: "width:auto;margin-right:6px", onchange: e => fn(e.target.checked) }), on ? "On" : "Off");
  kids.push(h("div", { class: "card" }, h("h3", {}, "Agent mode"), h("p", { class: "note", style: "margin-top:0" }, "Lets Sai look at and act on your device photos using tools. Agent mode works with the cloud model (DeepSeek); small on-device models are not good at tools."),
    h("div", { class: "row", style: "margin-top:6px" }, h("span", {}, "Agent mode"), toggle(agentMode, v => { agentMode = v; localStorage.setItem("sai-agent", v ? "1" : "0"); })),
    h("div", { class: "row", style: "margin-top:10px" }, h("span", {}, "Confirm destructive actions"), toggle(confirmDestructive, v => { confirmDestructive = v; localStorage.setItem("sai-confirm", v ? "1" : "0"); }))));
  kids.push(h("div", { class: "card" }, h("h3", {}, "Photo access"),
    h("div", { class: "row" }, h("span", {}, state.photoPermission ? "Granted" : "Not granted"), h("button", { class: "mini " + (state.photoPermission ? "" : "primary"), onclick: () => native("request-photo-permission").then(r => { refreshState().then(renderAgent); if (r.pending) toast("Approve the photo prompt"); }) }, state.photoPermission ? "Manage" : "Grant"))));
  const list = h("div", { class: "card" }, h("h3", {}, "Tools Sai can use"));
  for (const t of TOOLS) list.append(h("div", { class: "item" }, h("div", { class: "grow" }, h("b", {}, TOOL_LABEL[t.function.name] || t.function.name), h("small", { class: "dim" }, t.function.description))));
  kids.push(list);
  setSection("agent", kids);
}

// ---------------- photos (pCloud) ----------------
let pcloudItems = [], pcloudLoaded = false, pcloudQuery = "", pcloudStatus = null, pcloudBusy = false, pcloudStatusLoading = false;

async function loadPcloudLibrary() {
  if (pcloudBusy) return;
  pcloudBusy = true; toast("Reading your pCloud photos…");
  try {
    const r = await native("pcloud-library");
    if (r.error) throw new Error(r.error);
    pcloudItems = (r.items || []).map(x => ({ id: x.id, name: x.fileName || x.name || "photo", folder: x.folderPath || x.folderName || "", addedAt: Number(x.addedAt) || 0, size: Number(x.size) || 0, version: x.version || "", mediaType: x.mediaType || "photo" }));
    pcloudLoaded = true;
    toast(pcloudItems.length + " photo(s) found");
  } catch (e) { toast(e.message); }
  finally { pcloudBusy = false; if (tab === "photos") renderPhotos(); }
}

function pcloudMatches(item, q) {
  if (!q) return true;
  const hay = (item.name + " " + item.folder).toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}

function renderPhotos() {
  const conn = Boolean(state.pcloud);
  const kids = [];
  const connCard = h("div", { class: "card" }, h("h3", {}, "pCloud photos"));
  if (!conn) {
    connCard.append(
      h("p", { class: "note", style: "margin-top:0" }, "Connect your pCloud account to search your cloud photo library. Sai AI reads file names and folders directly from pCloud; nothing is uploaded."),
      h("div", { class: "actions" }, h("button", { class: "primary", onclick: connectPcloud }, "Connect pCloud")),
      h("div", { class: "field" }, h("label", {}, "Or paste a pCloud access token"), h("input", { type: "password", id: "pcloudToken", placeholder: "access token" })),
      h("div", { class: "actions" }, h("button", { onclick: usePcloudToken }, "Use token")));
  } else {
    if (!pcloudStatus && !pcloudStatusLoading) {
      pcloudStatusLoading = true;
      native("pcloud-status").then(r => { pcloudStatus = r; }).catch(() => {}).finally(() => { pcloudStatusLoading = false; if (tab === "photos") renderPhotos(); });
    }
    const q = pcloudStatus || {};
    connCard.append(
      h("div", { class: "row" }, h("div", { class: "grow", style: "min-width:0" }, h("b", {}, q.email || "Connected"), q.quota ? h("small", { class: "dim" }, `${fmtBytes(q.used)} of ${fmtBytes(q.quota)} used`) : null),
        h("button", { class: "mini", onclick: () => native("pcloud-disconnect").then(() => { state.pcloud = false; pcloudItems = []; pcloudLoaded = false; pcloudStatus = null; pcloudQuery = ""; toast("Disconnected"); renderPhotos(); }) }, "Disconnect")),
      h("div", { class: "actions" },
        h("button", { class: "primary", onclick: loadPcloudLibrary }, pcloudLoaded ? "Refresh library" : "Load my photos"),
        state.saiphotos ? h("button", { onclick: () => openInSaiPhotos({ view: "albums" }) }, "Albums in Sai Photos") : null,
        state.saiphotos ? h("button", { onclick: () => openInSaiPhotos({ view: "search" }) }, "Search in Sai Photos") : null));
  }
  kids.push(connCard);

  if (conn && pcloudLoaded) {
    kids.push(h("div", { class: "card" }, h("div", { class: "field", style: "margin:0" },
      h("input", { id: "pcloudSearch", placeholder: "Search file names and folders…", value: pcloudQuery, oninput: e => { pcloudQuery = e.target.value; paintPcloudResults(); } }))));
    kids.push(h("div", { id: "pcloudResults", class: "photogrid" }));
    setSection("photos", kids);
    paintPcloudResults();
    return;
  }
  if (conn && !pcloudLoaded) kids.push(h("div", { class: "card" }, h("p", { class: "note", style: "margin:0" }, "Tap “Load my photos” to read your pCloud photo list. Large libraries can take a moment.")));
  kids.push(h("div", { class: "card" }, h("h3", {}, "On this device"),
    h("p", { class: "note", style: "margin-top:0" }, "Sai's agent can list, open, share, wallpaper, delete and album device photos from the Chat tab (Agent mode + cloud model)."),
    h("div", { class: "actions" }, state.saiphotos ? h("button", { onclick: () => native("open-in-saiphotos", {}).then(r => { if (!r.opened) toast("Sai Photos could not be opened"); }) }, "Open Sai Photos") : h("span", { class: "dim" }, "Sai Photos is not installed."))));
  setSection("photos", kids);
}

function paintPcloudResults() {
  const box = $("#pcloudResults"); if (!box) return;
  box.textContent = "";
  const q = pcloudQuery.trim();
  const rows = pcloudItems.filter(x => pcloudMatches(x, q)).slice(0, 60);
  if (!rows.length) { box.append(h("div", { class: "empty" }, q ? "No matching photos." : "No photos in your pCloud folders.")); return; }
  for (const item of rows) {
    const img = h("img", { alt: item.name, loading: "lazy" });
    const cell = h("button", { class: "photocell", title: item.name, onclick: () => pickPcloud(item) }, img, h("small", {}, item.name));
    box.append(cell);
    queueThumb(item, img);
  }
}

const thumbQueue = []; let thumbsActive = 0;
function queueThumb(item, img) { thumbQueue.push({ item, img }); pumpThumbs(); }
function pumpThumbs() {
  while (thumbsActive < 4 && thumbQueue.length) {
    const job = thumbQueue.shift(); thumbsActive++;
    native("pcloud-thumb", { id: job.item.id, version: job.item.version }).then(r => { if (r && r.data && job.img.isConnected) job.img.src = r.data; })
      .catch(() => {}).finally(() => { thumbsActive--; pumpThumbs(); });
  }
}
function pickPcloud(item) {
  if (!state.saiphotos) { toast("Install Sai Photos to open this photo."); return; }
  openInSaiPhotos({ photo: item.id });
}
function openInSaiPhotos(params) { return native("open-in-saiphotos", params).then(r => { if (!r.opened) toast("Sai Photos could not be opened"); return r; }); }
async function connectPcloud() {
  try { const r = await native("pcloud-start"); if (!r.url) throw new Error("Could not start pCloud login."); await native("open-url", { url: r.url }); toast("Complete sign-in in your browser, then return."); }
  catch (e) { toast(e.message); }
}
async function usePcloudToken() {
  const field = $("#pcloudToken"); const token = field ? field.value : ""; if (!token.trim()) { toast("Paste a pCloud token first."); return; }
  toast("Checking token…");
  try { const r = await native("pcloud-token", { token: token.trim() }); if (r.error) throw new Error(r.error); state.pcloud = true; pcloudStatus = r; toast("pCloud connected"); renderPhotos(); }
  catch (e) { toast(e.message); }
}

// ---------------- settings ----------------
function renderSettings() {
  const p = state.provider;
  const s = current();
  setSection("settings", [
    h("div", { class: "card" }, h("h3", {}, "Cloud model (DeepSeek)"),
      h("p", { class: "note", style: "margin-top:0" }, "Any OpenAI-compatible service works. For free DeepSeek V4.1 Flash, create a key at OpenRouter and keep the default settings."),
      h("div", { class: "field" }, h("label", {}, "Base URL"), h("input", { id: "baseUrl", value: p.baseUrl || "https://openrouter.ai/api/v1" })),
      h("div", { class: "field" }, h("label", {}, "Model"), h("input", { id: "model", value: p.model || "deepseek/deepseek-v4-flash:free" })),
      h("div", { class: "field" }, h("label", {}, "API key"), h("input", { id: "apiKey", type: "password", placeholder: p.hasKey ? "Key saved" : "sk-…" })),
      h("div", { class: "actions" }, h("button", { class: "primary", onclick: saveProvider }, "Save"), h("button", { onclick: testCloud }, "Test")),
      h("div", { class: "actions" }, h("button", { class: "ghost", onclick: () => native("provider-clear").then(r => { state = r; toast("Cleared"); renderSettings(); }) }, "Forget key"))),
    h("div", { class: "card" }, h("h3", {}, "Assistant"),
      h("div", { class: "field" }, h("label", {}, "System prompt"), h("textarea", { id: "sysPrompt", rows: "4" }, state.systemPrompt)),
      h("div", { class: "field" }, h("label", {}, "Temperature (" + state.temperature.toFixed(2) + ")"), h("input", { id: "temp", type: "range", min: "0", max: "1.2", step: "0.05", value: String(state.temperature) })),
      h("div", { class: "actions" }, h("button", { onclick: async () => { const t = parseFloat($("#temp").value); const r = await native("save-config", { systemPrompt: $("#sysPrompt").value, temperature: t }); state = r; toast("Saved"); await native("reset-chat"); } }, "Save & restart chat"))),
    h("div", { class: "card" }, h("h3", {}, "About"), h("p", { class: "note", style: "margin-top:0" }, `Sai AI v${state.version}. On-device inference by Google LiteRT-LM. Cloud fallback for DeepSeek V4.1 Flash (free tier). Your photos never leave the phone unless you use the cloud model.`))
  ]);
}
async function saveProvider() { const key = $("#apiKey").value; const r = await native("provider-save", { baseUrl: $("#baseUrl").value.trim(), model: $("#model").value.trim(), apiKey: key }); state = r; toast("Saved"); renderSettings(); }
async function testCloud() { toast("Testing…"); try { const r = await native("cloud-test"); toast("Cloud replied: " + (r.reply || "ok")); } catch (e) { toast(e.message); } }

// ---------------- shell ----------------
function switchTab(t) { tab = t; document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === t)); Object.keys(sections()).forEach(n => { const el = document.getElementById("sec-" + n); if (el) el.classList.toggle("on", n === t); }); refreshTab(); }
function sections() { return { chat: 1, photos: 1, models: 1, agent: 1, settings: 1 }; }
function refreshTab() { if (tab === "chat") renderChat(); if (tab === "photos") renderPhotos(); if (tab === "models") renderModels(); if (tab === "agent") renderAgent(); if (tab === "settings") renderSettings(); paintChips(); }
function paintChips() {
  const c = $("#chips"); c.textContent = "";
  const e = state.engine || {};
  c.append(h("span", { class: "chip " + (e.loaded ? "on" : "off") }, e.loaded ? "Offline ✓" : (e.loading ? "Loading…" : "No model")));
  const keyOk = state.provider && state.provider.hasKey;
  c.append(h("span", { class: "chip " + (keyOk ? "cloud" : "off") }, keyOk ? "Cloud ✓" : "Cloud key?"));
  c.append(h("span", { class: "chip " + (agentMode ? "on" : "") }, agentMode ? "Agent" : "Chat"));
}
function refreshState() { return native("state").then(s => { state = s; if (mode === "cloud" && !state.provider.hasKey) mode = "local"; localStorage.setItem("sai-mode", mode); paintChips(); }).catch(() => {}); }
window.saiBack = () => { const d = document.querySelector("dialog[open]"); if (d) { d.close(); return true; } if (tab !== "chat") { switchTab("chat"); return true; } return false; };

document.querySelectorAll("nav button").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));

(function init() {
  // composer + mode bar
  const main = $("#view");
  const modebar = h("div", { class: "modebar" },
    h("button", { class: mode === "local" ? "on" : "", id: "modeLocal", onclick: () => setMode("local") }, "On-device"),
    h("button", { class: mode === "cloud" ? "on" : "", id: "modeCloud", onclick: () => setMode("cloud") }, "DeepSeek (cloud)"),
    h("button", { id: "btnNew", onclick: newChat, style: "margin-left:auto" }, "New"));
  const composer = h("div", { class: "composer" }, h("textarea", { id: "composer", rows: "1", placeholder: "Message Sai…" }), h("button", { class: "primary", id: "sendBtn", onclick: send }, "➤"));
  document.body.append(composer);
  header_modebar_placeholder(modebar);
  $("#composer").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  $("#composer").addEventListener("input", e => { e.target.style.height = "auto"; e.target.style.height = Math.min(120, e.target.scrollHeight) + "px"; });
  native("state").then(s => { state = s; } ).catch(() => {}).finally(() => { switchTab("chat"); refreshState(); });
  setInterval(() => { if (tab === "chat" || tab === "models") refreshState(); }, 5000);
})();
function header_modebar_placeholder(bar) { const main = $("#view"); main.parentNode.insertBefore(bar, main); }
function setMode(m) { mode = m; localStorage.setItem("sai-mode", m); $("#modeLocal").classList.toggle("on", m === "local"); $("#modeCloud").classList.toggle("on", m === "cloud"); paintChips(); if (m === "cloud" && !(state.provider && state.provider.hasKey)) toast("Add a cloud API key in Settings."); }
