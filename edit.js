/* ============================================================
   edit.js — add text, drawing, highlights, signatures,
   watermark, and crop pages. Everything stays local.

   Limitation: this tool renders pages ignoring any pre-existing
   page rotation flag, so it assumes pages are already "upright".
   If a page looks sideways here, straighten it in the Organize
   tool first, edit it, then rotate again if you need to.
   ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

(function () {
  var uploadPanel = document.getElementById('upload-panel');
  var editorPanel = document.getElementById('editor-panel');
  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('file-input');
  var uploadStatus = document.getElementById('upload-status');
  var editorStatus = document.getElementById('editor-status');
  var sidebarThumbs = document.getElementById('sidebar-thumbs');
  var pageIndicator = document.getElementById('page-indicator');
  var canvasStack = document.getElementById('canvas-stack');
  var bgCanvas = document.getElementById('bg-canvas');
  var overlayCanvas = document.getElementById('overlay-canvas');
  var overlayCtx = overlayCanvas.getContext('2d');

  var SCALE = 1.5;

  var fileName = 'document.pdf';
  var fileBytes = null;
  var pdfjsDoc = null;
  var numPages = 0;
  var currentPage = 0;

  var pageSizesPt = [];      // {width,height} in PDF points, per page
  var pageAnnotations = [];  // array of annotation arrays, per page
  var pageCrop = [];         // {x,y,w,h} in PDF points, or null, per page
  var pendingCropRect = null; // {x,y,w,h} in canvas px while dragging/editing

  var currentTool = 'text';
  var signature = null; // { dataUrl, bytes, aspect } aspect = height/width
  var signaturePad = null;

  // -------------------- Upload --------------------

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
      pageAnnotations = new Array(numPages).fill(null).map(function () { return []; });
      pageCrop = new Array(numPages).fill(null);
      pageSizesPt = new Array(numPages).fill(null);
      hideProgress();
      uploadPanel.style.display = 'none';
      editorPanel.style.display = 'block';
      buildSidebar();
      setCurrentPage(0);
    }).catch(function (err) {
      hideProgress();
      showStatus(uploadStatus, 'Could not read that PDF: ' + err.message, true);
    });
  }

  // -------------------- Sidebar thumbnails --------------------

  function buildSidebar() {
    sidebarThumbs.innerHTML = '';
    for (var i = 0; i < numPages; i++) {
      (function (idx) {
        var el = document.createElement('div');
        el.className = 'mini-thumb';
        el.dataset.idx = idx;
        var num = document.createElement('div');
        num.className = 'mini-num';
        num.textContent = 'Page ' + (idx + 1);
        el.appendChild(num);
        el.addEventListener('click', function () { setCurrentPage(idx); });
        sidebarThumbs.appendChild(el);
        pdfjsDoc.getPage(idx + 1).then(function (page) {
          var vp = page.getViewport({ scale: 1, rotation: 0 });
          var scale = 150 / vp.width;
          var viewport = page.getViewport({ scale: scale, rotation: 0 });
          var canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          el.insertBefore(canvas, num);
          page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport });
        });
      })(i);
    }
    highlightSidebar();
  }

  function highlightSidebar() {
    sidebarThumbs.querySelectorAll('.mini-thumb').forEach(function (el) {
      el.classList.toggle('active', parseInt(el.dataset.idx, 10) === currentPage);
    });
  }

  // -------------------- Page rendering --------------------

  function setCurrentPage(idx) {
    currentPage = idx;
    pendingCropRect = null;
    highlightSidebar();
    pageIndicator.textContent = 'Page ' + (idx + 1) + ' of ' + numPages;
    showProgress('Loading page…');
    pdfjsDoc.getPage(idx + 1).then(function (page) {
      var viewport = page.getViewport({ scale: SCALE, rotation: 0 });
      bgCanvas.width = overlayCanvas.width = viewport.width;
      bgCanvas.height = overlayCanvas.height = viewport.height;
      canvasStack.style.width = viewport.width + 'px';
      canvasStack.style.height = viewport.height + 'px';
      pageSizesPt[idx] = { width: viewport.width / SCALE, height: viewport.height / SCALE };
      return page.render({ canvasContext: bgCanvas.getContext('2d'), viewport: viewport }).promise;
    }).then(function () {
      hideProgress();
      if (pageCrop[idx]) pendingCropRect = pdfCropToCanvasRect(pageCrop[idx]);
      redrawOverlay();
    }).catch(function (err) {
      hideProgress();
      showStatus(editorStatus, 'Could not render page: ' + err.message, true);
    });
  }

  // -------------------- Coordinate helpers --------------------

  function canvasToPdf(cx, cy) {
    var h = pageSizesPt[currentPage].height;
    return { x: cx / SCALE, y: h - cy / SCALE };
  }
  function pdfToCanvas(px, py) {
    var h = pageSizesPt[currentPage].height;
    return { x: px * SCALE, y: (h - py) * SCALE };
  }
  function pdfCropToCanvasRect(crop) {
    var topLeft = pdfToCanvas(crop.x, crop.y + crop.h);
    return { x: topLeft.x, y: topLeft.y, w: crop.w * SCALE, h: crop.h * SCALE };
  }
  function canvasRectToPdfCrop(rect) {
    var bl = canvasToPdf(rect.x, rect.y + rect.h);
    return { x: bl.x, y: bl.y, w: rect.w / SCALE, h: rect.h / SCALE };
  }
  function hexToColor(hex) {
    hex = hex.replace('#', '');
    return {
      r: parseInt(hex.substr(0, 2), 16), g: parseInt(hex.substr(2, 2), 16), b: parseInt(hex.substr(4, 2), 16)
    };
  }
  function hexToCss(hex) { return hex; }
  function hexToRgb01(hex) {
    var c = hexToColor(hex);
    return PDFLib.rgb(c.r / 255, c.g / 255, c.b / 255);
  }

  // -------------------- Overlay redraw --------------------

  function redrawOverlay() {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    var anns = pageAnnotations[currentPage] || [];
    anns.forEach(drawAnnotation);
    if (pendingCropRect) {
      overlayCtx.save();
      overlayCtx.strokeStyle = '#3b5bfd';
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([6, 4]);
      overlayCtx.strokeRect(pendingCropRect.x, pendingCropRect.y, pendingCropRect.w, pendingCropRect.h);
      overlayCtx.fillStyle = 'rgba(59,91,253,0.08)';
      overlayCtx.fillRect(pendingCropRect.x, pendingCropRect.y, pendingCropRect.w, pendingCropRect.h);
      overlayCtx.restore();
    }
  }

  function drawAnnotation(ann) {
    if (ann.type === 'text' || ann.type === 'watermark') {
      var c = pdfToCanvas(ann.x, ann.y);
      overlayCtx.save();
      overlayCtx.globalAlpha = ann.opacity != null ? ann.opacity : 1;
      overlayCtx.fillStyle = ann.color;
      overlayCtx.font = (ann.size * SCALE) + 'px Helvetica, Arial, sans-serif';
      overlayCtx.textBaseline = 'alphabetic';
      if (ann.type === 'watermark') {
        overlayCtx.translate(c.x, c.y);
        overlayCtx.rotate(-ann.rotationDeg * Math.PI / 180);
        overlayCtx.fillText(ann.text, 0, 0);
      } else {
        overlayCtx.fillText(ann.text, c.x, c.y);
      }
      overlayCtx.restore();
    } else if (ann.type === 'draw') {
      if (ann.points.length < 2) return;
      overlayCtx.save();
      overlayCtx.strokeStyle = ann.color;
      overlayCtx.lineWidth = ann.width * SCALE;
      overlayCtx.lineCap = 'round';
      overlayCtx.lineJoin = 'round';
      overlayCtx.beginPath();
      var p0 = pdfToCanvas(ann.points[0].x, ann.points[0].y);
      overlayCtx.moveTo(p0.x, p0.y);
      for (var i = 1; i < ann.points.length; i++) {
        var p = pdfToCanvas(ann.points[i].x, ann.points[i].y);
        overlayCtx.lineTo(p.x, p.y);
      }
      overlayCtx.stroke();
      overlayCtx.restore();
    } else if (ann.type === 'highlight') {
      var tl = pdfToCanvas(ann.x, ann.y + ann.h);
      overlayCtx.save();
      overlayCtx.globalAlpha = 0.4;
      overlayCtx.fillStyle = ann.color;
      overlayCtx.fillRect(tl.x, tl.y, ann.w * SCALE, ann.h * SCALE);
      overlayCtx.restore();
    } else if (ann.type === 'image') {
      var itl = pdfToCanvas(ann.x, ann.y + ann.h);
      if (ann.img) overlayCtx.drawImage(ann.img, itl.x, itl.y, ann.w * SCALE, ann.h * SCALE);
    }
  }

  // -------------------- Tool tabs --------------------

  document.querySelectorAll('.tool-tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tool-tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tool-options').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      document.getElementById('opt-' + currentTool).classList.add('active');
      closeTextInput();
    });
  });

  ['text-size', 'draw-width', 'wm-size', 'wm-opacity', 'sig-width'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function () {
      var valEl = document.getElementById(id + '-val');
      if (valEl) valEl.textContent = el.value + (id === 'wm-opacity' ? '%' : '');
    });
  });

  // -------------------- Overlay pointer interaction --------------------

  var dragState = null; // { kind, startX, startY, points }
  var textInputEl = null;

  overlayCanvas.addEventListener('pointerdown', function (e) {
    if (textInputEl) return;
    var rect = overlayCanvas.getBoundingClientRect();
    var cx = (e.clientX - rect.left) * (overlayCanvas.width / rect.width);
    var cy = (e.clientY - rect.top) * (overlayCanvas.height / rect.height);

    if (currentTool === 'text') {
      openTextInput(cx, cy);
      return;
    }
    if (currentTool === 'sign') {
      placeSignature(cx, cy);
      return;
    }
    if (currentTool === 'draw') {
      var pdfPt = canvasToPdf(cx, cy);
      dragState = { kind: 'draw', points: [pdfPt] };
      overlayCanvas.setPointerCapture(e.pointerId);
      return;
    }
    if (currentTool === 'highlight' || currentTool === 'crop') {
      dragState = { kind: currentTool, startX: cx, startY: cy };
      overlayCanvas.setPointerCapture(e.pointerId);
      return;
    }
  });

  overlayCanvas.addEventListener('pointermove', function (e) {
    if (!dragState) return;
    var rect = overlayCanvas.getBoundingClientRect();
    var cx = (e.clientX - rect.left) * (overlayCanvas.width / rect.width);
    var cy = (e.clientY - rect.top) * (overlayCanvas.height / rect.height);

    if (dragState.kind === 'draw') {
      dragState.points.push(canvasToPdf(cx, cy));
      redrawOverlay();
      drawAnnotation({
        type: 'draw', points: dragState.points,
        color: document.getElementById('draw-color').value,
        width: parseFloat(document.getElementById('draw-width').value)
      });
      return;
    }
    if (dragState.kind === 'highlight' || dragState.kind === 'crop') {
      var x = Math.min(cx, dragState.startX), y = Math.min(cy, dragState.startY);
      var w = Math.abs(cx - dragState.startX), h = Math.abs(cy - dragState.startY);
      redrawOverlay();
      if (dragState.kind === 'highlight') {
        overlayCtx.save();
        overlayCtx.globalAlpha = 0.4;
        overlayCtx.fillStyle = document.getElementById('hl-color').value;
        overlayCtx.fillRect(x, y, w, h);
        overlayCtx.restore();
      } else {
        pendingCropRect = { x: x, y: y, w: w, h: h };
        redrawOverlay();
      }
      dragState.rect = { x: x, y: y, w: w, h: h };
    }
  });

  overlayCanvas.addEventListener('pointerup', function () {
    if (!dragState) return;
    if (dragState.kind === 'draw' && dragState.points.length > 1) {
      pageAnnotations[currentPage].push({
        type: 'draw', points: dragState.points,
        color: document.getElementById('draw-color').value,
        width: parseFloat(document.getElementById('draw-width').value)
      });
    } else if (dragState.kind === 'highlight' && dragState.rect && dragState.rect.w > 3 && dragState.rect.h > 3) {
      var pdfRect = canvasRectToPdfCrop(dragState.rect);
      pageAnnotations[currentPage].push({
        type: 'highlight', x: pdfRect.x, y: pdfRect.y, w: pdfRect.w, h: pdfRect.h,
        color: document.getElementById('hl-color').value
      });
    } else if (dragState.kind === 'crop' && dragState.rect) {
      pendingCropRect = dragState.rect;
    }
    dragState = null;
    redrawOverlay();
  });

  // -------------------- Text tool --------------------

  function openTextInput(cx, cy) {
    closeTextInput();
    var rect = overlayCanvas.getBoundingClientRect();
    var displayScale = rect.width / overlayCanvas.width;
    textInputEl = document.createElement('textarea');
    textInputEl.rows = 1;
    var size = parseFloat(document.getElementById('text-size').value);
    var color = document.getElementById('text-color').value;
    textInputEl.style.position = 'absolute';
    textInputEl.style.left = (cx * displayScale) + 'px';
    textInputEl.style.top = (cy * displayScale - size * displayScale) + 'px';
    textInputEl.style.font = (size * SCALE * displayScale) + 'px Helvetica, Arial, sans-serif';
    textInputEl.style.color = color;
    textInputEl.style.border = '1px dashed #3b5bfd';
    textInputEl.style.background = 'rgba(255,255,255,0.85)';
    textInputEl.style.padding = '2px 4px';
    textInputEl.style.minWidth = '120px';
    textInputEl.style.resize = 'both';
    textInputEl.style.zIndex = 10;
    textInputEl.dataset.cx = cx;
    textInputEl.dataset.cy = cy;
    canvasStack.appendChild(textInputEl);
    textInputEl.focus();

    textInputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextInput(); }
      if (e.key === 'Escape') { closeTextInput(); }
    });
    textInputEl.addEventListener('blur', function () { commitTextInput(); });
  }

  function commitTextInput() {
    if (!textInputEl) return;
    var text = textInputEl.value.trim();
    var cx = parseFloat(textInputEl.dataset.cx), cy = parseFloat(textInputEl.dataset.cy);
    closeTextInput();
    if (!text) return;
    var pt = canvasToPdf(cx, cy);
    pageAnnotations[currentPage].push({
      type: 'text', x: pt.x, y: pt.y, text: text,
      size: parseFloat(document.getElementById('text-size').value),
      color: document.getElementById('text-color').value
    });
    redrawOverlay();
  }

  function closeTextInput() {
    if (textInputEl && textInputEl.parentNode) textInputEl.parentNode.removeChild(textInputEl);
    textInputEl = null;
  }

  // -------------------- Signature tool --------------------

  var signatureModal = document.getElementById('signature-modal');
  var sigCanvas = document.getElementById('signature-pad-canvas');

  document.getElementById('btn-open-signature').addEventListener('click', function () {
    signatureModal.classList.add('open');
    var ratio = Math.max(window.devicePixelRatio || 1, 1);
    sigCanvas.width = sigCanvas.offsetWidth * ratio;
    sigCanvas.height = sigCanvas.offsetHeight * ratio;
    sigCanvas.getContext('2d').scale(ratio, ratio);
    if (signaturePad) signaturePad.clear();
    signaturePad = new SignaturePad(sigCanvas, { backgroundColor: 'rgba(0,0,0,0)', penColor: '#111827' });
  });
  document.getElementById('btn-sig-clear').addEventListener('click', function () { signaturePad.clear(); });
  document.getElementById('btn-sig-cancel').addEventListener('click', function () { signatureModal.classList.remove('open'); });
  document.getElementById('btn-sig-use').addEventListener('click', function () {
    if (signaturePad.isEmpty()) { return; }
    var dataUrl = signaturePad.toDataURL('image/png');
    var aspect = sigCanvas.height / sigCanvas.width;
    var img = new Image();
    img.onload = function () {
      dataUrlToBytes(dataUrl).then(function (bytes) {
        signature = { dataUrl: dataUrl, bytes: bytes, aspect: aspect, img: img };
        signatureModal.classList.remove('open');
        document.getElementById('sign-hint').textContent = 'Click on the page to place your signature. You can click again to place it more than once.';
        document.querySelectorAll('.tool-tab-btn').forEach(function (b) {
          if (b.dataset.tool === 'sign') b.click();
        });
      });
    };
    img.src = dataUrl;
  });

  function placeSignature(cx, cy) {
    if (!signature) {
      showStatus(editorStatus, 'Draw a signature first using the button in the Sign panel.', true);
      return;
    }
    var w = parseFloat(document.getElementById('sig-width').value);
    var h = w * signature.aspect;
    var centerPt = canvasToPdf(cx, cy);
    pageAnnotations[currentPage].push({
      type: 'image', x: centerPt.x - w / 2, y: centerPt.y - h / 2, w: w, h: h,
      bytes: signature.bytes, img: signature.img
    });
    redrawOverlay();
  }

  function dataUrlToBytes(dataUrl) {
    return fetch(dataUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) { return new Uint8Array(buf); });
  }

  // -------------------- Crop tool --------------------

  document.getElementById('btn-apply-crop').addEventListener('click', function () {
    if (!pendingCropRect) { showStatus(editorStatus, 'Drag a box on the page first.', true); return; }
    pageCrop[currentPage] = canvasRectToPdfCrop(pendingCropRect);
    showStatus(editorStatus, 'Crop set for page ' + (currentPage + 1) + '.', false);
  });
  document.getElementById('btn-remove-crop').addEventListener('click', function () {
    pageCrop[currentPage] = null;
    pendingCropRect = null;
    redrawOverlay();
    showStatus(editorStatus, 'Crop removed for page ' + (currentPage + 1) + '.', false);
  });

  // -------------------- Watermark tool --------------------

  document.getElementById('btn-apply-watermark').addEventListener('click', function () {
    var text = document.getElementById('wm-text').value.trim();
    if (!text) { showStatus(editorStatus, 'Enter watermark text first.', true); return; }
    var size = parseFloat(document.getElementById('wm-size').value);
    var opacity = parseFloat(document.getElementById('wm-opacity').value) / 100;
    var rotationDeg = parseFloat(document.getElementById('wm-rotation').value) || 0;
    var color = document.getElementById('wm-color').value;
    var allPages = document.getElementById('wm-all-pages').checked;

    var measureCanvas = document.createElement('canvas');
    var mctx = measureCanvas.getContext('2d');
    mctx.font = size + 'px Helvetica, Arial, sans-serif';
    var approxWidth = mctx.measureText(text).width;
    var rotRad = rotationDeg * Math.PI / 180;

    var targets = allPages ? Array.from({ length: numPages }, function (_, i) { return i; }) : [currentPage];
    targets.forEach(function (pIdx) {
      // Remove any existing watermark on that page before adding a new one
      pageAnnotations[pIdx] = pageAnnotations[pIdx].filter(function (a) { return a.type !== 'watermark'; });
      var dims = pageSizesPt[pIdx] || pageSizesPt[currentPage];
      var cx = dims.width / 2, cy = dims.height / 2;
      var x = cx - (approxWidth / 2) * Math.cos(rotRad);
      var y = cy - (approxWidth / 2) * Math.sin(rotRad);
      pageAnnotations[pIdx].push({
        type: 'watermark', text: text, x: x, y: y, size: size, opacity: opacity, rotationDeg: rotationDeg, color: color
      });
    });
    redrawOverlay();
    showStatus(editorStatus, 'Watermark added to ' + (allPages ? 'all pages' : 'this page') + '.', false);
  });

  // -------------------- Undo / clear --------------------

  document.getElementById('btn-undo').addEventListener('click', function () {
    pageAnnotations[currentPage].pop();
    redrawOverlay();
  });
  document.getElementById('btn-clear-page').addEventListener('click', function () {
    pageAnnotations[currentPage] = [];
    redrawOverlay();
  });

  // -------------------- Export --------------------

  document.getElementById('btn-download').addEventListener('click', function () {
    showProgress('Building your PDF…');
    buildOutputPdf().then(function (bytes) {
      hideProgress();
      downloadFile(bytes, suggestOutputName(fileName, 'edited'), 'application/pdf');
      showStatus(editorStatus, 'Done! Your PDF was downloaded.', false);
    }).catch(function (err) {
      hideProgress();
      showStatus(editorStatus, 'Something went wrong: ' + err.message, true);
    });
  });

  function buildOutputPdf() {
    return PDFLib.PDFDocument.load(fileBytes.slice(0)).then(function (doc) {
      return doc.embedFont(PDFLib.StandardFonts.Helvetica).then(function (font) {
        var chain = Promise.resolve();
        for (var i = 0; i < numPages; i++) {
          (function (idx) {
            chain = chain.then(function () { return applyPageEdits(doc, idx, font); });
          })(i);
        }
        return chain.then(function () { return doc.save(); });
      });
    });
  }

  function applyPageEdits(doc, idx, font) {
    var page = doc.getPage(idx);
    if (pageCrop[idx]) {
      var c = pageCrop[idx];
      page.setCropBox(c.x, c.y, c.w, c.h);
    }
    var anns = pageAnnotations[idx] || [];
    var chain = Promise.resolve();
    anns.forEach(function (ann) {
      chain = chain.then(function () { return drawAnnotationOnPdfPage(doc, page, ann, font); });
    });
    return chain;
  }

  function drawAnnotationOnPdfPage(doc, page, ann, font) {
    if (ann.type === 'text') {
      page.drawText(ann.text, { x: ann.x, y: ann.y - ann.size * 0.2, size: ann.size, font: font, color: hexToRgb01(ann.color) });
      return Promise.resolve();
    }
    if (ann.type === 'watermark') {
      page.drawText(ann.text, {
        x: ann.x, y: ann.y, size: ann.size, font: font, color: hexToRgb01(ann.color),
        opacity: ann.opacity, rotate: PDFLib.degrees(ann.rotationDeg)
      });
      return Promise.resolve();
    }
    if (ann.type === 'draw') {
      for (var i = 0; i < ann.points.length - 1; i++) {
        page.drawLine({
          start: ann.points[i], end: ann.points[i + 1],
          thickness: ann.width, color: hexToRgb01(ann.color)
        });
      }
      return Promise.resolve();
    }
    if (ann.type === 'highlight') {
      page.drawRectangle({ x: ann.x, y: ann.y, width: ann.w, height: ann.h, color: hexToRgb01(ann.color), opacity: 0.4 });
      return Promise.resolve();
    }
    if (ann.type === 'image') {
      return doc.embedPng(ann.bytes).then(function (embedded) {
        page.drawImage(embedded, { x: ann.x, y: ann.y, width: ann.w, height: ann.h });
      });
    }
    return Promise.resolve();
  }
})();
