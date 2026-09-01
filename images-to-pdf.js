/* ============================================================
   images-to-pdf.js — combine JPG/PNG images into one PDF.
   ============================================================ */

(function () {
  var uploadPanel = document.getElementById('upload-panel');
  var editorPanel = document.getElementById('editor-panel');
  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('file-input');
  var uploadStatus = document.getElementById('upload-status');
  var editorStatus = document.getElementById('editor-status');
  var fileListEl = document.getElementById('file-list');

  // { id, name, bytes(ArrayBuffer), mime, dataUrl }
  var images = [];
  var nextId = 1;

  setupDropZone(dropzone, fileInput, handleFiles);
  document.getElementById('btn-add-more').addEventListener('click', function () { fileInput.click(); });

  function handleFiles(fileList) {
    var files = Array.from(fileList).filter(function (f) { return /^image\/(png|jpeg)$/.test(f.type); });
    if (!files.length) {
      showStatus(uploadStatus, 'Please choose JPG or PNG images.', true);
      return;
    }
    Promise.all(files.map(readOneImage)).then(function (newImages) {
      images = images.concat(newImages);
      uploadPanel.style.display = 'none';
      editorPanel.style.display = 'block';
      renderList();
    });
  }

  function readOneImage(file) {
    return Promise.all([readFileAsArrayBuffer(file), readFileAsDataURL(file)]).then(function (res) {
      return {
        id: 'i' + (nextId++),
        name: file.name,
        bytes: res[0],
        mime: file.type,
        dataUrl: res[1]
      };
    });
  }

  function renderList() {
    fileListEl.innerHTML = '';
    images.forEach(function (img) {
      var row = document.createElement('div');
      row.className = 'file-row';
      row.draggable = true;
      row.dataset.id = img.id;
      row.innerHTML =
        '<span class="drag-handle">⠿</span>' +
        '<img src="' + img.dataUrl + '" style="width:40px;height:40px;object-fit:cover;border-radius:5px;border:1px solid #eee;">' +
        '<span class="file-name">' + escapeHtml(img.name) + '</span>' +
        '<button class="btn btn-sm btn-icon btn-danger" data-act="remove">🗑</button>';
      row.querySelector('[data-act="remove"]').addEventListener('click', function () {
        images = images.filter(function (i) { return i.id !== img.id; });
        renderList();
      });
      row.addEventListener('dragstart', function (e) {
        row.classList.add('dragging');
        e.dataTransfer.setData('text/plain', img.id);
      });
      row.addEventListener('dragend', function () { row.classList.remove('dragging'); });
      row.addEventListener('dragover', function (e) { e.preventDefault(); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        var draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === img.id) return;
        var fromIdx = images.findIndex(function (i) { return i.id === draggedId; });
        var toIdx = images.findIndex(function (i) { return i.id === img.id; });
        var moved = images.splice(fromIdx, 1)[0];
        toIdx = images.findIndex(function (i) { return i.id === img.id; });
        images.splice(toIdx, 0, moved);
        renderList();
      });
      fileListEl.appendChild(row);
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  document.getElementById('btn-convert').addEventListener('click', function () {
    if (!images.length) return showStatus(editorStatus, 'Add at least one image first.', true);
    showProgress('Creating PDF…');
    buildPdf().then(function (bytes) {
      hideProgress();
      downloadFile(bytes, 'images.pdf', 'application/pdf');
      showStatus(editorStatus, 'Done! Your PDF was downloaded.', false);
    }).catch(function (err) {
      hideProgress();
      showStatus(editorStatus, 'Something went wrong: ' + err.message, true);
    });
  });

  function buildPdf() {
    var sizeMode = document.getElementById('page-size').value;
    var margin = parseInt(document.getElementById('margin').value, 10) || 0;

    return PDFLib.PDFDocument.create().then(function (doc) {
      var chain = Promise.resolve();
      images.forEach(function (img) {
        chain = chain.then(function () { return addImagePage(doc, img, sizeMode, margin); });
      });
      return chain.then(function () { return doc.save(); });
    });
  }

  function addImagePage(doc, img, sizeMode, margin) {
    var embedPromise = img.mime === 'image/png' ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes);
    return embedPromise.then(function (embedded) {
      var pageW, pageH;
      if (sizeMode === 'fit') {
        pageW = embedded.width + margin * 2;
        pageH = embedded.height + margin * 2;
      } else if (sizeMode === 'letter') {
        pageW = 612; pageH = 792;
      } else {
        pageW = 595.28; pageH = 841.89; // A4
      }
      var page = doc.addPage([pageW, pageH]);
      var maxW = pageW - margin * 2;
      var maxH = pageH - margin * 2;
      var scale = Math.min(maxW / embedded.width, maxH / embedded.height, sizeMode === 'fit' ? 1 : Infinity);
      if (!isFinite(scale) || scale <= 0) scale = 1;
      var w = embedded.width * scale;
      var h = embedded.height * scale;
      page.drawImage(embedded, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
    });
  }
})();
