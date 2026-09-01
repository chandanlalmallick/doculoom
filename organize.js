/* ============================================================
   organize.js — merge, delete, reorder, duplicate, rotate,
   insert blank/image pages. All processing is local.
   ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

(function () {
  var uploadPanel = document.getElementById('upload-panel');
  var editorPanel = document.getElementById('editor-panel');
  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('file-input');
  var uploadStatus = document.getElementById('upload-status');
  var editorStatus = document.getElementById('editor-status');
  var pageGrid = document.getElementById('page-grid');
  var imagePageInput = document.getElementById('image-page-input');

  // Each loaded source PDF: { name, bytes(ArrayBuffer), pdfjsDoc, pdfLibDocPromise }
  var sources = [];
  var nextId = 1;

  // Each entry in `items` represents one output page.
  // kind 'page'  -> { id, kind:'page', srcIndex, pageIndex, rotationDelta }
  // kind 'blank' -> { id, kind:'blank', rotationDelta }
  // kind 'image' -> { id, kind:'image', bytes, mime, rotationDelta }
  var items = [];

  var pendingInsertAfterId = null; // used by the image-page file input callback

  setupDropZone(dropzone, fileInput, handleFiles);
  document.getElementById('btn-add-more').addEventListener('click', function () { fileInput.click(); });

  function handleFiles(fileList) {
    var files = Array.from(fileList).filter(function (f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); });
    if (!files.length) {
      showStatus(uploadStatus, 'Please choose PDF files.', true);
      return;
    }
    showProgress('Loading PDF' + (files.length > 1 ? 's' : '') + '…');
    loadFilesSequentially(files).then(function () {
      hideProgress();
      uploadPanel.style.display = 'none';
      editorPanel.style.display = 'block';
      renderGrid();
    }).catch(function (err) {
      hideProgress();
      showStatus(uploadStatus, 'Could not read one of the files: ' + err.message, true);
    });
  }

  function loadFilesSequentially(files) {
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () { return loadOneFile(file); });
    });
    return chain;
  }

  function loadOneFile(file) {
    return readFileAsArrayBuffer(file).then(function (buf) {
      return pdfjsLib.getDocument({ data: buf.slice(0) }).promise.then(function (pdfjsDoc) {
        var srcIndex = sources.length;
        sources.push({ name: file.name, bytes: buf, pdfjsDoc: pdfjsDoc, pdfLibDocPromise: null });
        for (var i = 0; i < pdfjsDoc.numPages; i++) {
          items.push({ id: 'p' + (nextId++), kind: 'page', srcIndex: srcIndex, pageIndex: i, rotationDelta: 0 });
        }
      });
    });
  }

  function getPdfLibDoc(srcIndex) {
    var src = sources[srcIndex];
    if (!src.pdfLibDocPromise) {
      src.pdfLibDocPromise = PDFLib.PDFDocument.load(src.bytes.slice(0));
    }
    return src.pdfLibDocPromise;
  }

  // ---------------- Rendering ----------------

  function renderGrid() {
    pageGrid.innerHTML = '';
    if (!items.length) {
      pageGrid.innerHTML = '<div class="empty-state"><div class="icon">📭</div>All pages removed. Add more PDFs or reload the page to start over.</div>';
      return;
    }
    items.forEach(function (item, idx) {
      var thumb = buildThumbEl(item, idx);
      pageGrid.appendChild(thumb);
      renderThumbContent(item, thumb);
    });
  }

  function buildThumbEl(item, idx) {
    var thumb = document.createElement('div');
    thumb.className = 'page-thumb' + (item.selected ? ' selected' : '');
    thumb.draggable = true;
    thumb.dataset.id = item.id;

    var wrap = document.createElement('div');
    wrap.className = 'thumb-canvas-wrap';
    thumb.appendChild(wrap);

    var check = document.createElement('div');
    check.className = 'thumb-check';
    check.textContent = item.selected ? '✓' : '';
    thumb.appendChild(check);

    var actions = document.createElement('div');
    actions.className = 'thumb-actions';
    actions.innerHTML =
      '<button data-act="rotate" title="Rotate">⟳</button>' +
      '<button data-act="duplicate" title="Duplicate">⧉</button>' +
      '<button data-act="delete" title="Delete">🗑</button>';
    thumb.appendChild(actions);

    var footer = document.createElement('div');
    footer.className = 'thumb-footer';
    footer.innerHTML = '<span>Page ' + (idx + 1) + '</span><span>' + labelFor(item) + '</span>';
    thumb.appendChild(footer);

    // Selection toggle
    wrap.addEventListener('click', function () {
      item.selected = !item.selected;
      thumb.classList.toggle('selected', item.selected);
      check.textContent = item.selected ? '✓' : '';
    });

    // Per-thumb quick actions
    actions.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      e.stopPropagation();
      var act = btn.dataset.act;
      if (act === 'rotate') rotateItems([item]);
      else if (act === 'duplicate') duplicateItems([item]);
      else if (act === 'delete') deleteItems([item]);
    });

    // Drag to reorder
    thumb.addEventListener('dragstart', function (e) {
      thumb.classList.add('dragging');
      e.dataTransfer.setData('text/plain', item.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    thumb.addEventListener('dragend', function () { thumb.classList.remove('dragging'); });
    thumb.addEventListener('dragover', function (e) {
      e.preventDefault();
      thumb.classList.add('drop-target');
    });
    thumb.addEventListener('dragleave', function () { thumb.classList.remove('drop-target'); });
    thumb.addEventListener('drop', function (e) {
      e.preventDefault();
      thumb.classList.remove('drop-target');
      var draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === item.id) return;
      moveItem(draggedId, item.id, e);
    });

    return thumb;
  }

  function labelFor(item) {
    if (item.kind === 'blank') return 'Blank';
    if (item.kind === 'image') return 'Image';
    return sources[item.srcIndex].name.replace(/\.pdf$/i, '');
  }

  function renderThumbContent(item, thumb) {
    var wrap = thumb.querySelector('.thumb-canvas-wrap');
    if (item.kind === 'blank') {
      var c = document.createElement('div');
      c.style.width = '100%';
      c.style.aspectRatio = '3/4';
      c.style.background = '#fff';
      c.style.border = '1px solid #ddd';
      wrap.appendChild(c);
      applyRotationStyle(wrap, item.rotationDelta);
      return;
    }
    if (item.kind === 'image') {
      var img = document.createElement('img');
      img.src = item.dataUrl;
      wrap.appendChild(img);
      applyRotationStyle(wrap, item.rotationDelta);
      return;
    }
    // kind === 'page'
    var src = sources[item.srcIndex];
    src.pdfjsDoc.getPage(item.pageIndex + 1).then(function (page) {
      var baseViewport = page.getViewport({ scale: 1 });
      var targetWidth = 260;
      var scale = targetWidth / baseViewport.width;
      var viewport = page.getViewport({ scale: scale, rotation: item.rotationDelta });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      wrap.appendChild(canvas);
      var ctx = canvas.getContext('2d');
      page.render({ canvasContext: ctx, viewport: viewport });
    });
  }

  function applyRotationStyle(wrap, rotationDelta) {
    if (rotationDelta) wrap.style.transform = 'rotate(' + rotationDelta + 'deg)';
  }

  // ---------------- Mutations ----------------

  function moveItem(draggedId, targetId, dropEvent) {
    var fromIdx = items.findIndex(function (i) { return i.id === draggedId; });
    var toIdx = items.findIndex(function (i) { return i.id === targetId; });
    if (fromIdx === -1 || toIdx === -1) return;
    var moved = items.splice(fromIdx, 1)[0];
    // Recompute target index after removal
    toIdx = items.findIndex(function (i) { return i.id === targetId; });
    // Decide before/after based on horizontal drop position within the target element
    var rect = dropEvent.currentTarget.getBoundingClientRect();
    var after = (dropEvent.clientX - rect.left) > rect.width / 2;
    items.splice(after ? toIdx + 1 : toIdx, 0, moved);
    renderGrid();
  }

  function getSelected() {
    return items.filter(function (i) { return i.selected; });
  }

  function rotateItems(list) {
    list.forEach(function (i) { i.rotationDelta = ((i.rotationDelta || 0) + 90) % 360; });
    renderGrid();
  }

  function duplicateItems(list) {
    list.forEach(function (item) {
      var idx = items.indexOf(item);
      var copy = Object.assign({}, item, { id: 'p' + (nextId++), selected: false });
      items.splice(idx + 1, 0, copy);
    });
    renderGrid();
  }

  function deleteItems(list) {
    var ids = list.map(function (i) { return i.id; });
    items = items.filter(function (i) { return ids.indexOf(i.id) === -1; });
    renderGrid();
  }

  function lastSelectedIndex() {
    for (var i = items.length - 1; i >= 0; i--) {
      if (items[i].selected) return i;
    }
    return items.length - 1;
  }

  function insertBlankPage() {
    var idx = lastSelectedIndex();
    items.splice(idx + 1, 0, { id: 'p' + (nextId++), kind: 'blank', rotationDelta: 0 });
    renderGrid();
  }

  function insertImagePage(file) {
    var mime = file.type || (/\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg');
    Promise.all([readFileAsArrayBuffer(file), readFileAsDataURL(file)]).then(function (res) {
      var idx = lastSelectedIndex();
      items.splice(idx + 1, 0, {
        id: 'p' + (nextId++), kind: 'image', bytes: res[0], mime: mime, dataUrl: res[1], rotationDelta: 0
      });
      renderGrid();
    });
  }

  // ---------------- Toolbar wiring ----------------

  document.getElementById('btn-select-all').addEventListener('click', function () {
    items.forEach(function (i) { i.selected = true; });
    renderGrid();
  });
  document.getElementById('btn-select-none').addEventListener('click', function () {
    items.forEach(function (i) { i.selected = false; });
    renderGrid();
  });
  document.getElementById('btn-rotate-left').addEventListener('click', function () {
    var sel = getSelected(); if (!sel.length) return showStatus(editorStatus, 'Select at least one page first.', true);
    sel.forEach(function (i) { i.rotationDelta = ((i.rotationDelta || 0) + 270) % 360; });
    renderGrid();
  });
  document.getElementById('btn-rotate-right').addEventListener('click', function () {
    var sel = getSelected(); if (!sel.length) return showStatus(editorStatus, 'Select at least one page first.', true);
    rotateItems(sel);
  });
  document.getElementById('btn-duplicate').addEventListener('click', function () {
    var sel = getSelected(); if (!sel.length) return showStatus(editorStatus, 'Select at least one page first.', true);
    duplicateItems(sel);
  });
  document.getElementById('btn-delete').addEventListener('click', function () {
    var sel = getSelected(); if (!sel.length) return showStatus(editorStatus, 'Select at least one page first.', true);
    deleteItems(sel);
  });
  document.getElementById('btn-add-blank').addEventListener('click', insertBlankPage);
  document.getElementById('btn-add-image').addEventListener('click', function () { imagePageInput.click(); });
  imagePageInput.addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) insertImagePage(e.target.files[0]);
    imagePageInput.value = '';
  });

  document.getElementById('btn-download').addEventListener('click', function () {
    if (!items.length) return showStatus(editorStatus, 'There are no pages to export.', true);
    showProgress('Building your PDF…');
    buildOutputPdf().then(function (bytes) {
      hideProgress();
      downloadFile(bytes, 'merged.pdf', 'application/pdf');
      showStatus(editorStatus, 'Done! Your PDF was downloaded.', false);
    }).catch(function (err) {
      hideProgress();
      showStatus(editorStatus, 'Something went wrong: ' + err.message, true);
    });
  });

  function buildOutputPdf() {
    var out = null;
    return PDFLib.PDFDocument.create().then(function (doc) {
      out = doc;
      var chain = Promise.resolve();
      items.forEach(function (item) {
        chain = chain.then(function () { return addItemToDoc(out, item); });
      });
      return chain;
    }).then(function () {
      return out.save();
    });
  }

  function addItemToDoc(out, item) {
    if (item.kind === 'blank') {
      var page = out.addPage([595.28, 841.89]);
      if (item.rotationDelta) page.setRotation(PDFLib.degrees(item.rotationDelta));
      return Promise.resolve();
    }
    if (item.kind === 'image') {
      var embedPromise = item.mime === 'image/png' ? out.embedPng(item.bytes) : out.embedJpg(item.bytes);
      return embedPromise.then(function (img) {
        var pageW = 595.28, pageH = 841.89;
        var scale = Math.min((pageW - 60) / img.width, (pageH - 60) / img.height, 1);
        var w = img.width * scale, h = img.height * scale;
        var p = out.addPage([pageW, pageH]);
        p.drawImage(img, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
        if (item.rotationDelta) p.setRotation(PDFLib.degrees(item.rotationDelta));
      });
    }
    // kind === 'page'
    return getPdfLibDoc(item.srcIndex).then(function (srcDoc) {
      return out.copyPages(srcDoc, [item.pageIndex]).then(function (copied) {
        var p = copied[0];
        var base = p.getRotation().angle || 0;
        p.setRotation(PDFLib.degrees((base + item.rotationDelta) % 360));
        out.addPage(p);
      });
    });
  }
})();
