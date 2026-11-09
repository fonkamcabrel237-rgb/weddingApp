// Navigation et formulaires instantanés (sans rechargement de page) pour les modules Mariés & Admin.
(function () {
  // --- Style & Toast ---
  var style = document.createElement('style');
  style.textContent = [
    '.nd-toast{position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-20px);z-index:9999;display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;font:600 .88rem/1.3 Inter,system-ui,sans-serif;box-shadow:0 12px 30px -6px rgba(0,0,0,.28);opacity:0;pointer-events:none;transition:opacity .22s ease,transform .22s ease;max-width:92vw;text-align:center;}',
    '.nd-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}',
    '.nd-toast.ok{background:#14532d;color:#f0fdf4;border:1px solid #22c55e;}',
    '.nd-toast.err{background:#7f1d1d;color:#fef2f2;border:1px solid #ef4444;}',
    '.nd-busy{opacity:.6;pointer-events:none;transition:opacity .15s;}'
  ].join('');
  document.head.appendChild(style);

  var toastEl = null;
  var toastTimer = null;
  function showToast(msg, type) {
    if (!msg) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'nd-toast';
      document.body.appendChild(toastEl);
    }
    clearTimeout(toastTimer);
    var icon = type === 'err' ? 'fa-triangle-exclamation' : 'fa-circle-check';
    toastEl.className = 'nd-toast ' + (type === 'err' ? 'err' : 'ok');
    toastEl.innerHTML = '<i class="fa-solid ' + icon + '"></i><span></span>';
    toastEl.querySelector('span').textContent = msg;
    requestAnimationFrame(function () { toastEl.classList.add('show'); });
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3000);
  }

  // --- Remplacement chirurgical du DOM sans saut de scroll ---
  function applyDocumentUpdate(doc, resUrl, sourceForm) {
    var scrollY = window.scrollY;

    // Extraire le message flash depuis l'URL finale (?ok=... ou ?err=...)
    try {
      var u = new URL(resUrl, window.location.origin);
      var okMsg = u.searchParams.get('ok');
      var errMsg = u.searchParams.get('err');
      if (okMsg) showToast(okMsg.trim(), 'ok');
      else if (errMsg) showToast(errMsg.trim(), 'err');
      else if (sourceForm) showToast('Modification enregistrée', 'ok');
    } catch (_) {
      if (sourceForm) showToast('Modification enregistrée', 'ok');
    }

    // Cas 1 : Page d'édition d'un mariage dans l'Admin (/admin/mariages/:id)
    if (document.querySelector('.admin-edit-form')) {
      var newHeader = doc.querySelector('.form-header-bar');
      var curHeader = document.querySelector('.form-header-bar');
      if (newHeader && curHeader) curHeader.innerHTML = newHeader.innerHTML;

      var newQuick = doc.querySelector('.admin-quick-actions');
      var curQuick = document.querySelector('.admin-quick-actions');
      if (newQuick && curQuick) curQuick.innerHTML = newQuick.innerHTML;

      var newMusic = doc.getElementById('musicUrlInput');
      var curMusic = document.getElementById('musicUrlInput');
      var curAudio = document.getElementById('adminAudioPreview');
      if (newMusic && curMusic && newMusic.value !== curMusic.value) {
        curMusic.value = newMusic.value;
        if (curAudio && newMusic.value) {
          curAudio.src = newMusic.value;
          curAudio.style.display = 'block';
        }
      }

      if (sourceForm && sourceForm.closest('#photos')) {
        var newPhotos = doc.getElementById('photos');
        var curPhotos = document.getElementById('photos');
        if (newPhotos && curPhotos) curPhotos.innerHTML = newPhotos.innerHTML;
      }
      window.scrollTo(0, scrollY);
      return;
    }

    // Cas 2 : Tableau de bord Admin (/admin)
    var curAdmin = document.querySelector('.container.page.admin-page');
    var newAdmin = doc.querySelector('.container.page.admin-page');
    if (curAdmin && newAdmin) {
      var flash = newAdmin.querySelector('.flash');
      if (flash) flash.remove();
      curAdmin.innerHTML = newAdmin.innerHTML;
      window.scrollTo(0, scrollY);
      return;
    }

    // Cas 3 : Espace Mariés (/espace/:slug) & Accueil Jour J (/espace/:slug/accueil)
    var curMain = document.querySelector('main.cp-wrap');
    var newMain = doc.querySelector('main.cp-wrap');
    if (curMain && newMain) {
      // Mémoriser les accordéons <details> ouverts et les invités déjà marqués "envoyés"
      var openDetails = [];
      curMain.querySelectorAll('details.cp-details').forEach(function (d, i) {
        if (d.open) openDetails.push(i);
      });
      var sentIds = {};
      curMain.querySelectorAll('.wa-send[data-done="1"]').forEach(function (b) {
        if (b.dataset.id) sentIds[b.dataset.id] = true;
      });

      // Supprimer les bannières flash statiques (déjà affichées via le toast flottant)
      newMain.querySelectorAll('.cp-banner.ok, .cp-banner.err').forEach(function (b) { b.remove(); });

      // Si on est sur /accueil et qu'on tape dans la recherche, ne mettre à jour que la liste des invités
      var activeEl = document.activeElement;
      if (activeEl && activeEl.name === 's' && curMain.querySelector('.cp-guests') && newMain.querySelector('.cp-guests')) {
        curMain.querySelector('.cp-guests').innerHTML = newMain.querySelector('.cp-guests').innerHTML;
        return;
      }

      curMain.innerHTML = newMain.innerHTML;

      // Restaurer les accordéons ouverts
      curMain.querySelectorAll('details.cp-details').forEach(function (d, i) {
        if (openDetails.indexOf(i) !== -1) d.open = true;
      });
      // Restaurer l'état d'envoi WhatsApp en session
      curMain.querySelectorAll('.wa-send').forEach(function (b) {
        if (b.dataset.id && sentIds[b.dataset.id]) {
          b.dataset.done = '1';
          var card = b.closest('.guest-card');
          if (card) card.classList.add('sent');
        }
      });

      window.scrollTo(0, scrollY);
    }
  }

  // --- Interception des soumissions de formulaires POST ---
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    if (form.dataset.noAjax !== undefined) return;
    var method = (form.getAttribute('method') || 'get').toUpperCase();
    if (method !== 'POST') return;

    e.preventDefault();
    var submitter = e.submitter;
    var busyTarget = submitter || form;
    busyTarget.classList.add('nd-busy');

    var action = form.getAttribute('action') || window.location.href;
    var isMultipart = (form.getAttribute('enctype') || '').toLowerCase() === 'multipart/form-data';
    var fd = new FormData(form);
    if (submitter && submitter.name && !fd.has(submitter.name)) {
      fd.append(submitter.name, submitter.value);
    }

    var fetchOpts = {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: isMultipart ? fd : new URLSearchParams(fd)
    };
    if (!isMultipart) {
      fetchOpts.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }

    fetch(action, fetchOpts)
      .then(function (res) {
        var finalUrl = res.url || action;
        var finalPath = new URL(finalUrl, window.location.origin).pathname;
        // Si redirection vers une autre page (ex: création ou suppression d'un mariage), suivre la navigation
        if (finalPath !== window.location.pathname) {
          window.location.href = finalUrl;
          return null;
        }
        return res.text().then(function (html) {
          return { html: html, url: finalUrl };
        });
      })
      .then(function (data) {
        if (!data) return;
        var doc = new DOMParser().parseFromString(data.html, 'text/html');
        applyDocumentUpdate(doc, data.url, form);
      })
      .catch(function () {
        showToast('Erreur réseau, réessayez.', 'err');
      })
      .finally(function () {
        busyTarget.classList.remove('nd-busy');
      });
  });

  // --- Filtres instantanés dans l'Espace Mariés (.cp-chips a) ---
  document.addEventListener('click', function (e) {
    var link = e.target.closest('.cp-chips a');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href || href.indexOf('?') !== 0) return;

    e.preventDefault();
    link.classList.add('nd-busy');
    var url = window.location.pathname + href.replace(/#.*$/, '');
    fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (res) { return res.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var newInvites = doc.getElementById('invites');
        var curInvites = document.getElementById('invites');
        if (newInvites && curInvites) {
          curInvites.innerHTML = newInvites.innerHTML;
          history.replaceState(null, '', href);
        }
      })
      .finally(function () { link.classList.remove('nd-busy'); });
  });

  // --- Recherche instantanée dans le Mode Accueil Jour J ---
  var searchTimer = null;
  document.addEventListener('input', function (e) {
    var input = e.target;
    if (!input || !input.closest('.cp-search')) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var form = input.closest('form');
      var url = window.location.pathname + '?s=' + encodeURIComponent(input.value.trim());
      fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (res) { return res.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          applyDocumentUpdate(doc, url, null);
          history.replaceState(null, '', input.value.trim() ? url : window.location.pathname);
        });
    }, 180);
  });
  document.addEventListener('submit', function (e) {
    if (e.target && e.target.classList.contains('cp-search')) {
      e.preventDefault();
    }
  });
})();
