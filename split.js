/* ============================================================
   split.js — extract pages / split into ranges. Local only.
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
  var selectionCount = document.getElementById('selection-count');

  var fileName = 'document.pdf';
  var fileBytes = null;
  var pdfjsDoc = null;
  var numPages = 0;
  var selected = []; // boolean per page (0-indexed)

  setupDropZone(dropzone, fileInput, function (files) { handleFile(files[0]); });

  function handleFile(file) {
    if (!file || (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))) {
      showStatus(uploadStatus, 'Please choose a PDF file.', true);
      return;
    }
    fileName = file.name;
    showProgress('Loading PDF…');
    readFileAsArrayBuffer(file).then(function (buf) {
      fileBytes = buf;
      return pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    }).then(function (doc) {
      pdfjsDoc = doc;
      numPages = doc.numPages;
      selected = new Array(numPages).fill(false);
      hideProgress();
      uploadPanel.style.display = 'none';
      editorPanel.style.display = 'block';
      renderGrid();
    }).catch(function (err) {
      hideProgress();
      showStatus(uploadStatus, 'Could not read that PDF: ' + err.message, true);
    });
  }

  function renderGrid() {
    pageGrid.innerHTML = '';
    for (var i = 0; i < numPages; i++) {
      pageGrid.appendChild(buildThumb(i));
    }
    updateSelectionCount();
  }

  function buildThumb(pageIndex) {
    var thumb = document.createElement('div');
    thumb.className = 'page-thumb' + (selected[pageIndex] ? ' selected' : '');

    var wrap = document.createElement('div');
    wrap.className = 'thumb-canvas-wrap';
    thumb.appendChild(wrap);

    var check = document.createElement('div');
    check.className = 'thumb-check';
    check.textContent = selected[pageIndex] ? '✓' : '';
    thumb.appendChild(check);

    var footer = document.createElement('div');
    footer.className = 'thumb-footer';
    footer.innerHTML = '<span>Page ' + (pageIndex + 1) + '</span>';
    thumb.appendChild(footer);

    thumb.addEventListener('click', function () {
      selected[pageIndex] = !selected[pageIndex];
      thumb.classList.toggle('selected', selected[pageIndex]);
      check.textContent = selected[pageIndex] ? '✓' : '';
      updateSelectionCount();
    });

    pdfjsDoc.getPage(pageIndex + 1).then(function (page) {
      var baseViewport = page.getViewport({ scale: 1 });
      var scale = 260 / baseViewport.width;
      var viewport = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      wrap.appendChild(canvas);
      page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport });
    });

    return thumb;
  }

  function updateSelectionCount() {
    var n = selected.filter(Boolean).length;
    selectionCount.textContent = n ? (n + ' of ' + numPages + ' pages selected') : (numPages + ' pages total');
  }

  document.getElementById('btn-select-all').addEventListener('click', function () {
    selected = selected.map(function () { return true; });
    renderGrid();
  });
  document.getElementById('btn-select-none').addEventListener('click', function () {
    selected = selected.map(function () { return false; });
    renderGrid();
  });

  function selectedIndices() {
    var out = [];
    selected.forEach(function (v, i) { if (v) out.push(i); });
    return out;
  }

  document.getElementById('btn-extract-selected').addEventListener('click', function () {
    var idx = selectedIndices();
    if (!idx.length) return showStatus(editorStatus, 'Select at least one page first.', true);
    showProgress('Building PDF…');
    extractPagesAsPdf(idx).then(function (bytes) {
      hideProgress();
      downloadFile(bytes, suggestOutputName(fileName, 'extracted'), 'application/pdf');
      showStatus(editorStatus, 'Done! Your PDF was downloaded.', false);
    }).catch(function (err) { hideProgress(); showStatus(editorStatus, err.message, true); });
  });

  document.getElementById('btn-each-selected').addEventListener('click', function () {
    var idx = selectedIndices();
    if (!idx.length) return showStatus(editorStatus, 'Select at least one page first.', true);
    showProgress('Building ZIP…');
    Promise.all(idx.map(function (i) { return extractPagesAsPdf([i]); })).then(function (allBytes) {
      var zip = new JSZip();
      allBytes.forEach(function (bytes, n) {
        zip.file(baseName(fileName) + '-page-' + (idx[n] + 1) + '.pdf', bytes);
      });
      return zip.generateAsync({ type: 'blob' });
    }).then(function (blob) {
      hideProgress();
      downloadFile(blob, baseName(fileName) + '-pages.zip', 'application/zip');
      showStatus(editorStatus, 'Done! Your ZIP was downloaded.', false);
    }).catch(function (err) { hideProgress(); showStatus(editorStatus, err.message, true); });
  });

  document.getElementById('btn-split-ranges').addEventListener('click', function () {
    var raw = document.getElementById('range-input').value.trim();
    if (!raw) return showStatus(editorStatus, 'Enter one or more page ranges, e.g. 1-3, 4, 5-7.', true);
    var ranges;
    try { ranges = parseRanges(raw, numPages); }
    catch (err) { return showStatus(editorStatus, err.message, true); }

    showProgress('Building ZIP…');
    Promise.all(ranges.map(function (r) { return extractPagesAsPdf(r); })).then(function (allBytes) {
      var zip = new JSZip();
      allBytes.forEach(function (bytes, n) {
        var r = ranges[n];
        var label = r.length === 1 ? ('page-' + (r[0] + 1)) : ('pages-' + (r[0] + 1) + '-' + (r[r.length - 1] + 1));
        zip.file(baseName(fileName) + '-' + label + '.pdf', bytes);
      });
      return zip.generateAsync({ type: 'blob' });
    }).then(function (blob) {
      hideProgress();
      downloadFile(blob, baseName(fileName) + '-split.zip', 'application/zip');
      showStatus(editorStatus, 'Done! Your ZIP was downloaded.', false);
    }).catch(function (err) { hideProgress(); showStatus(editorStatus, err.message, true); });
  });

  function parseRanges(raw, total) {
    var parts = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) throw new Error('Enter at least one range.');
    return parts.map(function (part) {
      var m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      var start, end;
      if (m) { start = parseInt(m[1], 10); end = parseInt(m[2], 10); }
      else if (/^\d+$/.test(part)) { start = end = parseInt(part, 10); }
      else throw new Error('Could not understand "' + part + '". Use formats like 1-3 or 5.');
      if (start < 1 || end > total || start > end) throw new Error('Range "' + part + '" is out of bounds (1-' + total + ').');
      var arr = [];
      for (var i = start; i <= end; i++) arr.push(i - 1);
      return arr;
    });
  }

  function extractPagesAsPdf(pageIndices) {
    return PDFLib.PDFDocument.load(fileBytes.slice(0)).then(function (srcDoc) {
      return PDFLib.PDFDocument.create().then(function (out) {
        return out.copyPages(srcDoc, pageIndices).then(function (pages) {
          pages.forEach(function (p) { out.addPage(p); });
          return out.save();
        });
      });
    });
  }

  function baseName(name) { return name.replace(/\.pdf$/i, ''); }
})();
