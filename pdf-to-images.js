/* ============================================================
   pdf-to-images.js — render PDF pages to JPG/PNG. Local only.
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
  var qualitySlider = document.getElementById('img-quality');
  var qualityValue = document.getElementById('quality-value');
  var formatSelect = document.getElementById('img-format');

  var fileName = 'document.pdf';
  var pdfjsDoc = null;
  var numPages = 0;
  var selected = [];

  setupDropZone(dropzone, fileInput, function (files) { handleFile(files[0]); });

  qualitySlider.addEventListener('input', function () { qualityValue.textContent = qualitySlider.value + '%'; });
  formatSelect.addEventListener('change', function () {
    document.getElementById('img-quality').closest('.field').style.opacity = formatSelect.value === 'image/jpeg' ? '1' : '0.4';
  });

  function handleFile(file) {
    if (!file || (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))) {
      showStatus(uploadStatus, 'Please choose a PDF file.', true);
      return;
    }
    fileName = file.name;
    showProgress('Loading PDF…');
    readFileAsArrayBuffer(file).then(function (buf) {
      return pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (doc) {
      pdfjsDoc = doc;
      numPages = doc.numPages;
      selected = new Array(numPages).fill(true);
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
    for (var i = 0; i < numPages; i++) pageGrid.appendChild(buildThumb(i));
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
    selectionCount.textContent = n + ' of ' + numPages + ' pages selected';
  }

  document.getElementById('btn-select-all').addEventListener('click', function () {
    selected = selected.map(function () { return true; });
    renderGrid();
  });
  document.getElementById('btn-select-none').addEventListener('click', function () {
    selected = selected.map(function () { return false; });
    renderGrid();
  });

  document.getElementById('btn-export').addEventListener('click', function () {
    var idx = [];
    selected.forEach(function (v, i) { if (v) idx.push(i); });
    if (!idx.length) return showStatus(editorStatus, 'Select at least one page first.', true);

    var format = formatSelect.value;
    var ext = format === 'image/png' ? 'png' : 'jpg';
    var quality = parseInt(qualitySlider.value, 10) / 100;
    var scale = parseFloat(document.getElementById('img-scale').value);
    var base = fileName.replace(/\.pdf$/i, '');

    showProgress('Rendering pages…');
    renderPagesToBlobs(idx, format, quality, scale).then(function (blobs) {
      if (blobs.length === 1) {
        hideProgress();
        downloadFile(blobs[0], base + '-page-' + (idx[0] + 1) + '.' + ext, format);
        showStatus(editorStatus, 'Done! Your image was downloaded.', false);
        return;
      }
      var zip = new JSZip();
      blobs.forEach(function (blob, n) { zip.file(base + '-page-' + (idx[n] + 1) + '.' + ext, blob); });
      return zip.generateAsync({ type: 'blob' }).then(function (zipBlob) {
        hideProgress();
        downloadFile(zipBlob, base + '-images.zip', 'application/zip');
        showStatus(editorStatus, 'Done! Your ZIP was downloaded.', false);
      });
    }).catch(function (err) {
      hideProgress();
      showStatus(editorStatus, 'Something went wrong: ' + err.message, true);
    });
  });

  function renderPagesToBlobs(indices, format, quality, scale) {
    var out = [];
    var chain = Promise.resolve();
    indices.forEach(function (i) {
      chain = chain.then(function () {
        return pdfjsDoc.getPage(i + 1).then(function (page) {
          var viewport = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          var ctx = canvas.getContext('2d');
          if (format === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
            return new Promise(function (resolve) {
              canvas.toBlob(function (blob) { out.push(blob); resolve(); }, format, quality);
            });
          });
        });
      });
    });
    return chain.then(function () { return out; });
  }
})();
