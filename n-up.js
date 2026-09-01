/* ============================================================
   n-up.js — put several PDF pages onto one sheet. Local only.
   ============================================================ */

(function () {
  var uploadPanel = document.getElementById('upload-panel');
  var editorPanel = document.getElementById('editor-panel');
  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('file-input');
  var uploadStatus = document.getElementById('upload-status');
  var editorStatus = document.getElementById('editor-status');
  var pageSummary = document.getElementById('page-summary');
  var perSheetSelect = document.getElementById('pages-per-sheet');
  var customFields = document.getElementById('custom-grid-fields');

  var fileName = 'document.pdf';
  var fileBytes = null;
  var numPages = 0;

  var LAYOUTS = { '2': [2, 1], '4': [2, 2], '6': [3, 2], '9': [3, 3], '12': [4, 3], '16': [4, 4] };

  setupDropZone(dropzone, fileInput, function (files) { handleFile(files[0]); });

  perSheetSelect.addEventListener('change', function () {
    customFields.style.display = perSheetSelect.value === 'custom' ? 'block' : 'none';
    updateSummary();
  });
  document.getElementById('custom-cols').addEventListener('input', updateSummary);
  document.getElementById('custom-rows').addEventListener('input', updateSummary);

  function handleFile(file) {
    if (!file || (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))) {
      showStatus(uploadStatus, 'Please choose a PDF file.', true);
      return;
    }
    fileName = file.name;
    showProgress('Loading PDF…');
    readFileAsArrayBuffer(file).then(function (buf) {
      fileBytes = buf;
      return PDFLib.PDFDocument.load(buf.slice(0));
    }).then(function (doc) {
      numPages = doc.getPageCount();
      hideProgress();
      uploadPanel.style.display = 'none';
      editorPanel.style.display = 'block';
      updateSummary();
    }).catch(function (err) {
      hideProgress();
      showStatus(uploadStatus, 'Could not read that PDF: ' + err.message, true);
    });
  }

  function getGrid() {
    if (perSheetSelect.value === 'custom') {
      var cols = Math.max(1, parseInt(document.getElementById('custom-cols').value, 10) || 1);
      var rows = Math.max(1, parseInt(document.getElementById('custom-rows').value, 10) || 1);
      return [cols, rows];
    }
    return LAYOUTS[perSheetSelect.value];
  }

  function updateSummary() {
    var grid = getGrid();
    var perSheet = grid[0] * grid[1];
    var sheets = Math.ceil(numPages / perSheet);
    pageSummary.textContent = numPages + ' source pages → ' + sheets + ' output sheet' + (sheets === 1 ? '' : 's') + ' (' + perSheet + ' per sheet)';
  }

  document.getElementById('btn-generate').addEventListener('click', function () {
    showProgress('Building layout…');
    buildNUpPdf().then(function (bytes) {
      hideProgress();
      downloadFile(bytes, suggestOutputName(fileName, 'nup'), 'application/pdf');
      showStatus(editorStatus, 'Done! Your PDF was downloaded.', false);
    }).catch(function (err) {
      hideProgress();
      showStatus(editorStatus, 'Something went wrong: ' + err.message, true);
    });
  });

  function buildNUpPdf() {
    var grid = getGrid();
    var cols = grid[0], rows = grid[1];
    var perSheet = cols * rows;
    var gap = parseInt(document.getElementById('gap').value, 10) || 0;
    var sizeKey = document.getElementById('sheet-size').value;
    var orientation = document.getElementById('orientation').value;

    var sheetSizes = { a4: [595.28, 841.89], letter: [612, 792] };
    var dims = sheetSizes[sizeKey];
    var pageW = orientation === 'landscape' ? Math.max(dims[0], dims[1]) : Math.min(dims[0], dims[1]);
    var pageH = orientation === 'landscape' ? Math.min(dims[0], dims[1]) : Math.max(dims[0], dims[1]);

    var margin = 20;

    return PDFLib.PDFDocument.load(fileBytes.slice(0)).then(function (srcDoc) {
      return PDFLib.PDFDocument.create().then(function (outDoc) {
        return outDoc.embedPages(srcDoc.getPages()).then(function (embeddedPages) {
          var cellW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
          var cellH = (pageH - margin * 2 - gap * (rows - 1)) / rows;

          for (var start = 0; start < embeddedPages.length; start += perSheet) {
            var outPage = outDoc.addPage([pageW, pageH]);
            for (var slot = 0; slot < perSheet && start + slot < embeddedPages.length; slot++) {
              var col = slot % cols;
              var row = Math.floor(slot / cols);
              var cellX = margin + col * (cellW + gap);
              // Row 0 = top of sheet, PDF y-origin is bottom-left, so flip.
              var cellY = pageH - margin - (row + 1) * cellH - row * gap;

              var ep = embeddedPages[start + slot];
              var scale = Math.min(cellW / ep.width, cellH / ep.height);
              var w = ep.width * scale, h = ep.height * scale;
              var x = cellX + (cellW - w) / 2;
              var y = cellY + (cellH - h) / 2;
              outPage.drawPage(ep, { x: x, y: y, width: w, height: h });
            }
          }
          return outDoc.save();
        });
      });
    });
  }
})();
