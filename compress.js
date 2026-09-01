/* ============================================================
   compress.js — shrink PDF file size. Local only.
   ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

(function () {
  var uploadPanel = document.getElementById('upload-panel');
  var editorPanel = document.getElementById('editor-panel');
  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('file-input');
  var uploadStatus = document.getElementById('upload-status');
  var editorStatus = document.getElementById('editor-status');
  var resultPanel = document.getElementById('result-panel');

  var fileName = 'document.pdf';
  var fileBytes = null;
  var originalSize = 0;
  var resultBytes = null;

  setupDropZone(dropzone, fileInput, function (files) { handleFile(files[0]); });

  document.querySelectorAll('input[name="mode"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      document.getElementById('strong-options').style.display =
        document.querySelector('input[name="mode"]:checked').value === 'strong' ? 'block' : 'none';
    });
  });
  document.getElementById('strong-quality').addEventListener('input', function (e) {
    document.getElementById('quality-value').textContent = e.target.value + '%';
  });

  function handleFile(file) {
    if (!file || (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))) {
      showStatus(uploadStatus, 'Please choose a PDF file.', true);
      return;
    }
    fileName = file.name;
    readFileAsArrayBuffer(file).then(function (buf) {
      fileBytes = buf;
      originalSize = buf.byteLength;
      document.getElementById('original-size').textContent = formatBytes(originalSize);
      document.getElementById('original-name').textContent = fileName;
      uploadPanel.style.display = 'none';
      editorPanel.style.display = 'block';
      resultPanel.style.display = 'none';
    }).catch(function (err) {
      showStatus(uploadStatus, 'Could not read that file: ' + err.message, true);
    });
  }

  document.getElementById('btn-compress').addEventListener('click', function () {
    var mode = document.querySelector('input[name="mode"]:checked').value;
    showProgress(mode === 'strong' ? 'Compressing (rendering pages)…' : 'Compressing…');
    var task = mode === 'strong' ? compressStrong() : compressLight();
    task.then(function (bytes) {
      hideProgress();
      resultBytes = bytes;
      var newSize = bytes.byteLength || bytes.length;
      document.getElementById('new-size').textContent = formatBytes(newSize);
      var pct = originalSize > 0 ? Math.round((1 - newSize / originalSize) * 100) : 0;
      var savingsEl = document.getElementById('savings');
      if (pct > 0) savingsEl.textContent = pct + '% smaller';
      else savingsEl.textContent = 'This file was already well optimized — little to no reduction possible.';
      resultPanel.style.display = 'block';
      showStatus(editorStatus, '', false);
    }).catch(function (err) {
      hideProgress();
      showStatus(editorStatus, 'Something went wrong: ' + err.message, true);
    });
  });

  function compressLight() {
    return PDFLib.PDFDocument.load(fileBytes.slice(0), { ignoreEncryption: true }).then(function (doc) {
      return doc.save({ useObjectStreams: true, addDefaultPage: false });
    });
  }

  function compressStrong() {
    var scale = parseFloat(document.getElementById('strong-dpi').value);
    var quality = parseInt(document.getElementById('strong-quality').value, 10) / 100;

    return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise.then(function (pdfjsDoc) {
      return PDFLib.PDFDocument.create().then(function (outDoc) {
        var chain = Promise.resolve();
        var pageCount = pdfjsDoc.numPages;
        for (var i = 1; i <= pageCount; i++) {
          (function (pageNum) {
            chain = chain.then(function () {
              return renderPageAsJpeg(pdfjsDoc, pageNum, scale, quality).then(function (result) {
                return outDoc.embedJpg(result.bytes).then(function (embedded) {
                  var page = outDoc.addPage([result.ptWidth, result.ptHeight]);
                  page.drawImage(embedded, { x: 0, y: 0, width: result.ptWidth, height: result.ptHeight });
                });
              });
            });
          })(i);
        }
        return chain.then(function () { return outDoc.save(); });
      });
    });
  }

  function renderPageAsJpeg(pdfjsDoc, pageNum, scale, quality) {
    return pdfjsDoc.getPage(pageNum).then(function (page) {
      var ptViewport = page.getViewport({ scale: 1 });
      var viewport = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        return new Promise(function (resolve) {
          canvas.toBlob(function (blob) {
            blob.arrayBuffer().then(function (buf) {
              resolve({ bytes: new Uint8Array(buf), ptWidth: ptViewport.width, ptHeight: ptViewport.height });
            });
          }, 'image/jpeg', quality);
        });
      });
    });
  }

  document.getElementById('btn-download').addEventListener('click', function () {
    if (!resultBytes) return;
    downloadFile(resultBytes, suggestOutputName(fileName, 'compressed'), 'application/pdf');
  });
})();
