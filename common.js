/* ============================================================
   common.js — helpers shared by every tool page.
   Nothing here ever sends files anywhere; everything stays
   inside the browser tab.
   ============================================================ */

(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.querySelector('.nav-toggle');
    var menu = document.querySelector('.nav-links');
    if (toggle && menu) {
      toggle.addEventListener('click', function () {
        menu.classList.toggle('open');
      });
      menu.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () { menu.classList.remove('open'); });
      });
    }

    // Mark current nav link active
    var path = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      var href = a.getAttribute('href');
      if (href === path) a.classList.add('active');
    });
  });

  window.formatBytes = function (bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    i = Math.min(i, units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
  };

  // Trigger a browser download for a Blob, Uint8Array or ArrayBuffer.
  window.downloadFile = function (data, filename, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  window.showStatus = function (el, message, isError) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('status-error', !!isError);
    el.classList.toggle('status-visible', !!message);
  };

  // Full-screen busy overlay, used while a heavy operation runs.
  window.showProgress = function (text) {
    var el = document.getElementById('progress-overlay');
    if (!el) return;
    el.querySelector('.progress-text').textContent = text || 'Working…';
    el.classList.add('open');
  };
  window.hideProgress = function () {
    var el = document.getElementById('progress-overlay');
    if (!el) return;
    el.classList.remove('open');
  };

  // Wire a drop zone: dropZoneEl gets drag-over styling, fileInputEl is a
  // hidden <input type="file">, onFiles(FileList) fires on drop or pick.
  window.setupDropZone = function (dropZoneEl, fileInputEl, onFiles) {
    if (!dropZoneEl || !fileInputEl) return;
    dropZoneEl.addEventListener('click', function () { fileInputEl.click(); });
    dropZoneEl.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZoneEl.classList.add('dragover');
    });
    dropZoneEl.addEventListener('dragleave', function () {
      dropZoneEl.classList.remove('dragover');
    });
    dropZoneEl.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZoneEl.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        onFiles(e.dataTransfer.files);
      }
    });
    fileInputEl.addEventListener('change', function (e) {
      if (e.target.files && e.target.files.length) {
        onFiles(e.target.files);
        fileInputEl.value = '';
      }
    });
  };

  window.readFileAsArrayBuffer = function (file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  window.readFileAsDataURL = function (file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Simple sequential-name generator, e.g. suggestOutputName('report.pdf','merged') -> 'report-merged.pdf'
  window.suggestOutputName = function (originalName, suffix, ext) {
    var base = (originalName || 'document').replace(/\.[^/.]+$/, '');
    return base + '-' + suffix + '.' + (ext || 'pdf');
  };
})();
