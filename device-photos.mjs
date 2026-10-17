export function setupDeviceSource({ api, toast }) {
  const $ = id => document.getElementById(id);
  const state = { items: [], total: 0, loading: false, finished: false, current: -1, zoom: 1, panX: 0, panY: 0 };
  const PAGE = 60;

  function renderTiles(items) {
    const grid = $('deviceGrid');
    for (const item of items) {
      const card = document.createElement('button');
      card.className = 'device-card'; card.type = 'button';
      card.dataset.id = item.id;
      const image = document.createElement('img');
      image.loading = 'lazy'; image.decoding = 'async'; image.alt = item.name || 'Device photo';
      image.src = '/.netlify/functions/device-photo-thumb?id=' + encodeURIComponent(item.id);
      card.append(image);
      card.onclick = () => openViewer(state.items.findIndex(entry => entry.id === item.id));
      grid.append(card);
    }
  }

  async function load(reset) {
    if (state.loading) return;
    state.loading = true;
    if (reset) { state.items = []; state.total = 0; state.finished = false; state.current = -1; $('deviceGrid').textContent = ''; }
    $('deviceStatus').textContent = 'Loading photos from this phone…';
    try {
      const result = await api('device-photos?offset=' + state.items.length + '&limit=' + PAGE);
      if (result.pendingPermission) {
        state.permissionTries = (state.permissionTries || 0) + 1;
        $('deviceStatus').textContent = 'Allow “Photos and videos” access for Sai Photos — the list fills automatically once you allow it.';
        $('deviceStatus').style.color = '#a86a1f';
        if (state.permissionTries < 30) setTimeout(() => load(true), 4000);
        return;
      }
      state.permissionTries = 0;
      $('deviceStatus').style.color = '';
      const items = result.items || [];
      state.total = result.total || state.total;
      state.items.push(...items);
      renderTiles(items);
      state.finished = !items.length || state.items.length >= state.total;
      $('loadMoreDevice').hidden = state.finished;
      $('deviceStatus').textContent = state.total ? state.total.toLocaleString() + ' photos on this phone' + (state.finished ? '' : ' · showing ' + state.items.length.toLocaleString()) : 'No photos found on this phone. Photos you copy to it (for example from an iPhone) appear here.';
    } catch (error) {
      $('deviceStatus').textContent = error.message || 'Could not read this phone’s photos.';
    } finally { state.loading = false; }
  }

  function applyTransform(instant) {
    const image = $('deviceViewerImage'); const stage = $('deviceStage');
    if (!image || !stage || !image.naturalWidth) return;
    const rect = stage.getBoundingClientRect(); const baseW = image.offsetWidth || rect.width; const baseH = image.offsetHeight || rect.height;
    const maxX = Math.max(0, (baseW * state.zoom - rect.width) / 2); const maxY = Math.max(0, (baseH * state.zoom - rect.height) / 2);
    state.panX = Math.max(-maxX, Math.min(maxX, state.panX)); state.panY = Math.max(-maxY, Math.min(maxY, state.panY));
    if (state.zoom <= 1.01) { state.panX = 0; state.panY = 0; }
    image.style.transition = instant ? 'none' : 'transform .18s ease-out';
    image.style.transform = `translate3d(${state.panX}px, ${state.panY}px, 0) scale(${state.zoom})`;
  }

  function zoomTo(value, clientX, clientY) {
    const next = Math.max(1, Math.min(8, value)); const stage = $('deviceStage'); const rect = stage.getBoundingClientRect();
    if (next <= 1.01) { state.panX = 0; state.panY = 0; }
    else if (clientX != null) {
      const fx = clientX - (rect.left + rect.width / 2); const fy = clientY - (rect.top + rect.height / 2); const factor = next / state.zoom;
      state.panX = fx - (fx - state.panX) * factor; state.panY = fy - (fy - state.panY) * factor;
    }
    state.zoom = next; applyTransform();
  }

  function updateViewer() {
    const item = state.items[state.current];
    if (!item) return;
    state.zoom = 1; state.panX = 0; state.panY = 0;
    const image = $('deviceViewerImage');
    image.style.transition = 'none'; image.style.transform = '';
    image.src = '/.netlify/functions/device-photo?id=' + encodeURIComponent(item.id);
    $('deviceViewerTitle').textContent = (item.name || 'Photo') + ' · ' + (item.size ? (item.size / 1048576).toFixed(1) + ' MB' : '') + (item.date ? ' · ' + new Date(item.date).toLocaleDateString() : '');
    $('deviceViewerPos').textContent = (state.current + 1) + ' / ' + state.items.length;
  }

  function relative(delta) {
    const next = state.current + delta;
    if (next < 0 || next >= state.items.length) return;
    state.current = next; updateViewer();
  }

  function openViewer(index) {
    if (index < 0) return;
    state.current = index;
    updateViewer();
    $('deviceMenu').hidden = true;
    $('deviceViewer').classList.add('chrome-hidden');
    if (!$('deviceViewer').open) $('deviceViewer').showModal();
  }

  async function removeCurrent() {
    const item = state.items[state.current];
    if (!item) return;
    $('deviceDeleteName').textContent = item.name || 'This photo';
    const result = await new Promise(resolve => {
      const dialog = $('deviceDeleteDialog');
      const onClose = () => { dialog.removeEventListener('close', onClose); resolve(dialog.returnValue); };
      dialog.addEventListener('close', onClose);
      dialog.showModal();
    });
    if (result !== 'delete') return;
    try {
      const response = await api('device-photo-delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: item.id }) });
      if (response.confirm) {
        toast('Confirm the deletion in the system dialog.');
        setTimeout(() => load(true), 1500);
      } else if (response.deleted) {
        toast('Deleted from this phone.');
        load(true);
      }
    } catch (error) { toast(error.message || 'Could not delete this photo.'); }
  }

  function wire() {
    $('loadMoreDevice').onclick = () => load(false);
    $('deviceViewerClose').onclick = () => $('deviceViewer').close();
    $('deviceDelete').onclick = () => { $('deviceMenu').hidden = true; removeCurrent(); };
    $('deviceShare').onclick = async () => {
      $('deviceMenu').hidden = true;
      const item = state.items[state.current]; if (!item) return;
      try {
        const response = await api('device-share-photo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: item.id, name: item.name || '' }) });
        if (response.shared) toast('Pick an app to share…');
      } catch (error) { toast(error.message || 'Could not share this photo.'); }
    };
    const deviceMenu = $('deviceMenu');
    $('deviceMenuButton').onclick = event => { event.stopPropagation(); deviceMenu.hidden = !deviceMenu.hidden; $('deviceMenuButton').setAttribute('aria-expanded', String(!deviceMenu.hidden)); };
    $('deviceViewerImage').onload = () => { if (state.zoom > 1.01) applyTransform(true); };
    $('deviceViewer').addEventListener('close', () => {
      state.zoom = 1; state.panX = 0; state.panY = 0;
      $('deviceViewerImage').style.transform = '';
      $('deviceViewer').classList.remove('chrome-hidden');
      deviceMenu.hidden = true;
    });

    const stage = $('deviceStage');
    const pointers = new Map(); let startX = 0; let startY = 0; let startTime = 0; let pinchDistance = 0; let pinchZoom = 1; let pinchFocus = { x: 0, y: 0 }; let pinchPan = { x: 0, y: 0 }; let hadPinch = false; let moved = false; let lastTap = 0; let lastTapX = 0; let lastTapY = 0;
    stage.onpointerdown = event => {
      stage.setPointerCapture(event.pointerId); pointers.set(event.pointerId, [event.clientX, event.clientY]);
      if (pointers.size === 1) { startX = event.clientX; startY = event.clientY; startTime = performance.now(); hadPinch = false; moved = false; }
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDistance = Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])); pinchZoom = state.zoom; pinchPan = { x: state.panX, y: state.panY }; const rect = stage.getBoundingClientRect(); pinchFocus = { x: (a[0] + b[0]) / 2 - (rect.left + rect.width / 2), y: (a[1] + b[1]) / 2 - (rect.top + rect.height / 2) }; hadPinch = true; }
    };
    stage.onpointermove = event => {
      const previous = pointers.get(event.pointerId); if (!previous) return;
      const dx = event.clientX - previous[0]; const dy = event.clientY - previous[1];
      pointers.set(event.pointerId, [event.clientX, event.clientY]);
      if (Math.abs(event.clientX - startX) > 10 || Math.abs(event.clientY - startY) > 10) moved = true;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const nextZoom = Math.max(1, Math.min(8, pinchZoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinchDistance));
        const factor = nextZoom / pinchZoom;
        state.panX = pinchFocus.x - (pinchFocus.x - pinchPan.x) * factor;
        state.panY = pinchFocus.y - (pinchFocus.y - pinchPan.y) * factor;
        state.zoom = nextZoom; applyTransform(true);
      } else if (state.zoom > 1) { state.panX += dx; state.panY += dy; applyTransform(true); }
    };
    stage.onpointerup = event => {
      pointers.delete(event.pointerId); if (pointers.size) return;
      const tap = !moved && !hadPinch && performance.now() - startTime < 400;
      if (tap) {
        const now = performance.now();
        if (now - lastTap < 320 && Math.hypot(event.clientX - lastTapX, event.clientY - lastTapY) < 48) { lastTap = 0; zoomTo(state.zoom > 1.05 ? 1 : 2.5, event.clientX, event.clientY); return; }
        lastTap = now; lastTapX = event.clientX; lastTapY = event.clientY;
        deviceMenu.hidden = true; $('deviceViewer').classList.toggle('chrome-hidden');
        return;
      }
      if (!hadPinch && state.zoom === 1 && Math.abs(event.clientX - startX) > 60 && Math.abs(event.clientX - startX) > Math.abs(event.clientY - startY) * 1.2) { relative(event.clientX > startX ? -1 : 1); return; }
      applyTransform();
    };
    stage.onpointercancel = event => pointers.delete(event.pointerId);
    stage.addEventListener('dblclick', event => event.preventDefault());
    stage.addEventListener('wheel', event => { if (!$('deviceViewer').open) return; event.preventDefault(); zoomTo(state.zoom * (event.deltaY < 0 ? 1.15 : 0.87), event.clientX, event.clientY); }, { passive: false });
  }

  function show() { load(true); }
  function hide() { if ($('deviceViewer').open) $('deviceViewer').close(); }

  wire();
  return { show, hide, reload: () => load(true) };
}
