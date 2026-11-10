(function () {
  // Enveloppe & Musique : ouverture et lancement automatique garanti
  var env = document.getElementById('envelope');
  var music = document.getElementById('music');
  var musicBtn = document.getElementById('musicBtn');
  var userPaused = false;
  var key = 'env:' + location.pathname + ':' + (music ? music.getAttribute('src') : '');

  function playMusic() {
    if (!music || userPaused || !music.paused) return;
    var p = music.play();
    if (p && typeof p.then === 'function') {
      p.then(function () {
        if (musicBtn) musicBtn.classList.add('playing');
      }).catch(function () {});
    } else if (musicBtn) {
      musicBtn.classList.add('playing');
    }
  }

  // Si l'autoplay initial a été différé par le navigateur, lancer au 1er clic/toucher
  function unlockAudioOnGesture() {
    if (!music || userPaused) return;
    playMusic();
    if (!music.paused) {
      ['click', 'touchstart', 'keydown'].forEach(function (ev) {
        document.removeEventListener(ev, unlockAudioOnGesture);
      });
    }
  }

  if (env) {
    if (sessionStorage.getItem(key) || location.hash) {
      env.classList.add('open');
      if (music) {
        playMusic();
        ['click', 'touchstart', 'keydown'].forEach(function (ev) {
          document.addEventListener(ev, unlockAudioOnGesture, { passive: true });
        });
      }
    } else {
      document.body.classList.add('locked');
    }
    document.getElementById('openEnvelope').addEventListener('click', function () {
      env.classList.add('open');
      document.body.classList.remove('locked');
      sessionStorage.setItem(key, '1');
      playMusic();
    });
  }
  if (musicBtn && music) {
    musicBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (music.paused) {
        userPaused = false;
        playMusic();
      } else {
        userPaused = true;
        music.pause();
        musicBtn.classList.remove('playing');
      }
    });
  }

  // Compte à rebours
  var cd = document.querySelector('.countdown');
  if (cd) {
    var target = new Date(cd.dataset.date).getTime();
    var units = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
    var els = {}; cd.querySelectorAll('[data-u]').forEach(function (e) { els[e.dataset.u] = e; });
    var tick = function () {
      var diff = Math.max(0, target - Date.now());
      if (diff === 0) { cd.innerHTML = '<div style="min-width:auto;padding:.6rem 1.2rem"><b>C\'est le grand jour ! 🎉</b></div>'; return; }
      var r = diff;
      ['d', 'h', 'm', 's'].forEach(function (u) { var v = Math.floor(r / units[u]); r -= v * units[u]; els[u].textContent = u === 'd' ? v : String(v).padStart(2, '0'); });
      setTimeout(tick, 1000);
    };
    tick();
  }

  // Apparition au scroll
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, { threshold: 0.12 }) : null;
  document.querySelectorAll('.reveal').forEach(function (el) { io ? io.observe(el) : el.classList.add('visible'); });

  // Galerie plein écran
  var lb = document.getElementById('lightbox');
  if (lb) {
    var img = lb.querySelector('img');
    document.querySelectorAll('.g-item').forEach(function (b) {
      b.addEventListener('click', function () { img.src = b.dataset.src; lb.hidden = false; });
    });
    lb.addEventListener('click', function () { lb.hidden = true; img.src = ''; });
  }

  // Cagnotte USSD dynamique (Mobile First)
  var cagnotteCard = document.getElementById('cagnotteCard');
  if (cagnotteCard) {
    var momoNum = cagnotteCard.dataset.momo || '';
    var omNum = cagnotteCard.dataset.om || '';
    var amountInput = document.getElementById('amount');
    var formAmount = document.getElementById('formAmount');
    var formOperator = document.getElementById('formOperator');
    var ussdDialBtn = document.getElementById('ussdDialBtn');
    var ussdBtnLabel = document.getElementById('ussdBtnLabel');
    var ussdCodeText = document.getElementById('ussdCodeText');
    var copyUssdBtn = document.getElementById('copyUssdBtn');
    var operatorCards = document.querySelectorAll('.operator-card');

    function fmtF(n) {
      return (Number(n) || 0).toLocaleString('fr-FR').replace(/\s/g, ' ') + ' FCFA';
    }

    function updateUssd() {
      var amt = parseInt(String((amountInput && amountInput.value) || '').replace(/\D/g, ''), 10) || 0;
      if (formAmount) formAmount.value = amt;

      var currentOp = 'momo';
      var checkedRadio = document.querySelector('input[name="op_choice"]:checked');
      if (checkedRadio) currentOp = checkedRadio.value;
      if (formOperator) formOperator.value = currentOp;

      var code = '';
      var telUri = '';
      var label = '';

      if (currentOp === 'om' && omNum) {
        code = '#150*1*1*' + omNum + '*' + amt + '#';
        telUri = 'tel:%23150*1*1*' + omNum + '*' + amt + '%23';
        label = 'Composer le code Orange (' + fmtF(amt) + ')';
        if (ussdDialBtn) {
          ussdDialBtn.className = 'btn btn-ussd op-om';
        }
      } else {
        var targetNum = momoNum || omNum;
        code = '*126*1*1*' + targetNum + '*' + amt + '#';
        telUri = 'tel:*126*1*1*' + targetNum + '*' + amt + '%23';
        label = 'Composer le code MoMo (' + fmtF(amt) + ')';
        if (ussdDialBtn) {
          ussdDialBtn.className = 'btn btn-ussd op-momo';
        }
      }

      if (ussdDialBtn) ussdDialBtn.href = telUri;
      if (ussdBtnLabel) ussdBtnLabel.textContent = label;
      if (ussdCodeText) ussdCodeText.textContent = code;
      if (copyUssdBtn) copyUssdBtn.dataset.copy = code;
    }

    if (amountInput) {
      amountInput.addEventListener('input', function () {
        var raw = amountInput.value.replace(/\D/g, '');
        document.querySelectorAll('.chip[data-amount]').forEach(function (c) {
          c.classList.toggle('active', c.dataset.amount === raw);
        });
        updateUssd();
      });
    }

    document.querySelectorAll('.chip[data-amount]').forEach(function (c) {
      c.addEventListener('click', function () {
        document.querySelectorAll('.chip[data-amount]').forEach(function (x) { x.classList.remove('active'); });
        c.classList.add('active');
        if (amountInput) amountInput.value = c.dataset.amount;
        updateUssd();
      });
    });

    operatorCards.forEach(function (card) {
      card.addEventListener('click', function () {
        operatorCards.forEach(function (x) { x.classList.remove('active'); });
        card.classList.add('active');
        var r = card.querySelector('input[type="radio"]');
        if (r) r.checked = true;
        updateUssd();
      });
    });

    updateUssd();
  }

  // Nombre de personnes masqué si absent
  var countField = document.querySelector('.count-field');
  document.querySelectorAll('input[name=attending]').forEach(function (r) {
    var sync = function () { if (countField) countField.style.display = document.querySelector('input[name=attending]:checked').value === 'yes' ? '' : 'none'; };
    r.addEventListener('change', sync); sync();
  });

  // Copier un numéro
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy).then(function () {
        var t = b.textContent; b.textContent = 'Copié ✓'; setTimeout(function () { b.textContent = t; }, 1500);
      });
    });
  });
})();
