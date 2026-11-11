/* Cliente do Apps Script, usado pelo site e pelo sistema dos vendedores. */
(function () {
  const TIMEOUT_MS = 30000;

  /**
   * Tela de espera: enquanto uma ação do usuário fala com o servidor, cobre a página,
   * bloqueia clique, toque e teclado e mostra um aviso com o que está acontecendo.
   * Aceita chamadas simultâneas (só libera quando a última terminar).
   */
  const Espera = (function () {
    let pendentes = 0, caixa, texto, mostrarT, focoAntes;

    function criar() {
      if (caixa) return;
      const css = document.createElement('style');
      css.textContent =
        '.espera{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;' +
        'background:rgba(0,0,0,0);cursor:wait;transition:background .2s ease}' +
        '.espera.vis{background:rgba(0,0,0,.55)}' +
        '.espera-box{display:flex;align-items:center;gap:14px;background:#fff;color:#1d2b22;border-radius:16px;' +
        'padding:16px 22px;box-shadow:0 18px 45px rgba(0,0,0,.35);font:600 1rem/1.3 Poppins,system-ui,sans-serif;' +
        'opacity:0;transform:translateY(6px);transition:opacity .2s ease,transform .2s ease}' +
        '.espera.vis .espera-box{opacity:1;transform:none}' +
        '.espera-spin{width:26px;height:26px;flex:none;border-radius:50%;border:3px solid #e2e2e2;border-top-color:var(--espera-cor,#1f8a4c);' +
        'animation:espera-gira .8s linear infinite}' +
        '@keyframes espera-gira{to{transform:rotate(360deg)}}' +
        '@media (prefers-reduced-motion:reduce){.espera-spin{animation-duration:2s}}';
      document.head.appendChild(css);

      caixa = document.createElement('div');
      caixa.className = 'espera';
      caixa.hidden = true;
      caixa.tabIndex = -1;
      caixa.setAttribute('role', 'alertdialog');
      caixa.setAttribute('aria-modal', 'true');
      caixa.setAttribute('aria-live', 'assertive');
      const box = document.createElement('div');
      box.className = 'espera-box';
      const spin = document.createElement('span');
      spin.className = 'espera-spin';
      spin.setAttribute('aria-hidden', 'true');
      texto = document.createElement('span');
      box.append(spin, texto);
      caixa.appendChild(box);
      document.body.appendChild(caixa);

      // segurança extra para navegadores sem "inert": engole o teclado enquanto espera
      document.addEventListener('keydown', (e) => {
        if (pendentes > 0) { e.preventDefault(); e.stopPropagation(); }
      }, true);
    }

    function travar(sim) {
      Array.prototype.forEach.call(document.body.children, (el) => {
        if (el === caixa || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
        if (sim) el.setAttribute('inert', ''); else el.removeAttribute('inert');
      });
      if (sim) document.body.setAttribute('aria-busy', 'true');
      else document.body.removeAttribute('aria-busy');
    }

    return {
      abrir(msg) {
        criar();
        texto.textContent = msg || 'Aguarde…';
        if (++pendentes > 1) return;
        focoAntes = document.activeElement;
        caixa.hidden = false;
        travar(true);
        caixa.focus();
        // o bloqueio é imediato; o aviso só aparece se demorar um pouco (evita piscar)
        clearTimeout(mostrarT);
        mostrarT = setTimeout(() => caixa.classList.add('vis'), 150);
      },
      fechar() {
        if (pendentes === 0 || --pendentes > 0) return;
        clearTimeout(mostrarT);
        caixa.classList.remove('vis');
        caixa.hidden = true;
        travar(false);
        if (focoAntes && focoAntes.isConnected && focoAntes.focus) focoAntes.focus();
        focoAntes = null;
      },
    };
  })();

  /** `espera`: texto do aviso. Se vier, a tela fica bloqueada até a resposta chegar. */
  async function chamar(url, opts, espera) {
    if (espera) Espera.abrir(espera);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(url, Object.assign({ signal: ctrl.signal, redirect: 'follow' }, opts));
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      if (!data || typeof data !== 'object') throw new Error('Resposta inválida');
      return data;
    } catch (err) {
      const msg = err.name === 'AbortError'
        ? 'O servidor demorou para responder. Verifique a internet e tente de novo.'
        : 'Não foi possível falar com o servidor. Verifique a internet e tente de novo.';
      return { ok: false, erro: msg, rede: true };
    } finally {
      clearTimeout(t);
      if (espera) Espera.fechar();
    }
  }

  window.API = {
    /** Leitura pública (progresso e números ocupados). Sem `espera`: atualiza em segundo plano. */
    status(espera) {
      return chamar(CONFIG.apiUrl + '?action=status&t=' + Date.now(), undefined, espera);
    },
    /**
     * Ações com dados pessoais: POST com corpo JSON (text/plain evita preflight de CORS).
     * Passe `espera` (ex.: 'Registrando…') quando for uma ação do usuário: a tela trava até responder.
     */
    post(body, espera) {
      return chamar(CONFIG.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      }, espera);
    },
  };

  /** Utilidades compartilhadas */
  window.Util = {
    mascaraTelefone(v) {
      const d = String(v).replace(/\D/g, '').slice(0, 11);
      if (d.length <= 2) return d.length ? '(' + d : '';
      if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
      if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
      return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    },
    linkWhatsapp(numero, texto) {
      const d = String(numero).replace(/\D/g, '');
      const tel = d.length <= 11 ? '55' + d : d;
      return 'https://wa.me/' + tel + (texto ? '?text=' + encodeURIComponent(texto) : '');
    },
    lerCache(chave) {
      try { return JSON.parse(localStorage.getItem(chave) || 'null'); } catch (e) { return null; }
    },
    gravarCache(chave, valor) {
      try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
    },
  };
})();
