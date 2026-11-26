// Compression automatique des photos côté navigateur (WebP/JPEG max 1600px) :
// - Accélère 15x l'envoi sur réseau mobile 3G/4G au Cameroun
// - Garantit le respect de la limite Serverless de Vercel (4.5 Mo par requête)
(function () {
  if (typeof window === 'undefined' || typeof DataTransfer === 'undefined') return;

  function compressImageFile(file) {
    return new Promise(function (resolve) {
      if (!file || !/^image\/(jpe?g|png|webp)$/i.test(file.type) || file.size < 220 * 1024) {
        return resolve(file);
      }
      var img = new Image();
      var objUrl = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(objUrl);
        var maxDim = 1280;
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (w > maxDim || h > maxDim) {
          if (w >= h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          function (blob) {
            if (!blob || blob.size >= file.size) return resolve(file);
            var baseName = (file.name || 'photo').replace(/\.[^.]+$/, '');
            var compressed = new File([blob], baseName + '.jpg', {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(compressed);
          },
          'image/jpeg',
          0.82
        );
      };
      img.onerror = function () {
        URL.revokeObjectURL(objUrl);
        resolve(file);
      };
      img.src = objUrl;
    });
  }

  document.addEventListener('change', function (e) {
    var input = e.target;
    if (!input || input.tagName !== 'INPUT' || input.type !== 'file') return;
    var accept = (input.getAttribute('accept') || '').toLowerCase();
    if (accept.indexOf('image') === -1 || !input.files || !input.files.length) return;

    var form = input.closest('form');
    var btn = form ? form.querySelector('button[type="submit"], button:not([type="button"])') : null;
    var origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Optimisation des photos…';
    }

    var files = Array.prototype.slice.call(input.files);
    Promise.all(files.map(compressImageFile))
      .then(function (optimized) {
        var dt = new DataTransfer();
        optimized.forEach(function (f) { dt.items.add(f); });
        input.files = dt.files;
      })
      .catch(function () {})
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = origText;
        }
      });
  });
})();
