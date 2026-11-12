(function () {
    'use strict';
    const C = window.CONFIG;
    const $ = (id) => document.getElementById(id);
    const CACHE_KEY = 'rifa-' + C.ano + '-status';

    // Ícones provisórios do prêmio (troque por imagens: itens[i].imagem = 'assets/premio/batedeira.webp')
    const ICONES = {
        batedeira: '<svg viewBox="0 0 48 48" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 40h28"/><path d="M14 40V20a8 8 0 0 1 8-8h12a6 6 0 0 1 6 6v2a4 4 0 0 1-4 4H22"/><path d="M22 24v4"/><path d="M17 28h14l-2 8H19z"/><circle cx="33" cy="17" r="1.5"/></svg>',
        liquidificador: '<svg viewBox="0 0 48 48" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 6h16l-2 24H18z"/><path d="M14 6h20"/><path d="M32 10h4v12h-5"/><path d="M15 30h18l2 12H13z"/><circle cx="24" cy="36" r="2"/><path d="M20 18l8 4M28 18l-8 4"/></svg>',
        churrasqueira: '<svg viewBox="0 0 48 48" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 20h32a16 12 0 0 1-32 0z"/><path d="M8 20h32"/><path d="M16 31l-5 12M32 31l5 12M24 32v11"/><path d="M18 8c-2 3 2 4 0 7M24 6c-2 3 2 5 0 9M30 8c-2 3 2 4 0 7"/></svg>',
        misteira: '<svg viewBox="0 0 48 48" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 27a16 9 0 0 1 32 0z"/><rect x="7" y="27" width="34" height="9" rx="3"/><path d="M40 30h4"/><path d="M13 36v3M35 36v3"/><circle cx="13" cy="31.5" r="1.2"/><path d="M19 21c1.5-1 3-1 4.5 0s3 1 4.5 0"/></svg>',
        presente: '<svg viewBox="0 0 48 48" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="18" width="32" height="8" rx="2"/><path d="M11 26v14h26V26"/><path d="M24 18v22"/><path d="M24 18c-3-6-11-7-11-2s8 2 11 2c3 0 11 3 11-2s-8-4-11 2z"/></svg>',
    };

    let estado = { total: C.totalNumeros, ocupados: 0, carregado: false };
    const sorteio = new Date(C.dataSorteio);

    // ---------------------------------------------------------------- textos
    function preencherTextos() {
        // selo e título (trecho em destaque fica dourado)
        const selo = C.selo || ['Sorteio', String(C.ano)];
        $('selo').querySelector('b').textContent = selo[0];
        $('selo').querySelector('i').textContent = selo[1] || '';
        $('selo').hidden = !selo[0];
        const t = C.titulo.trim();
        let dest = (C.tituloDestaque || '').trim();
        if (!dest || t.indexOf(dest) < 0) dest = t.split(/\s+/).pop();
        const i = t.indexOf(dest);
        const em = document.createElement('em');
        em.textContent = dest;
        $('titulo').textContent = '';
        $('titulo').append(t.slice(0, i), em, t.slice(i + dest.length));
        montarFaixa();
        $('chamada').textContent = C.chamada;
        $('data-sorteio').textContent = 'Sorteio em ' + sorteio.toLocaleDateString('pt-BR', {
            weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo',
        }) + ' às ' + sorteio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        $('org').textContent = C.organizacao;
        $('zap-rodape').href = Util.linkWhatsapp(C.whatsapp, 'Olá! Tenho uma dúvida sobre o sorteio ' + C.titulo + '.');

        $('pr-titulo').textContent = C.premio.titulo;
        $('pr-sub').textContent = C.premio.subtitulo;
        const box = $('itens');
        // itens por linha no computador: todos numa linha até 5; acima disso, em duas linhas equilibradas
        const n = C.premio.itens.length;
        box.style.setProperty('--por-linha', n <= 5 ? n : Math.ceil(n / 2));
        C.premio.itens.forEach((it) => {
            const card = document.createElement('article');
            card.className = 'item';
            const ic = document.createElement('div');
            ic.className = 'ic';
            if (it.imagem) {
                const img = document.createElement('img');
                img.src = it.imagem; img.alt = it.nome; img.loading = 'lazy';
                ic.appendChild(img);
            } else {
                ic.innerHTML = ICONES[it.icone] || ICONES.presente; // sem desenho próprio: presente
            }
            const h = document.createElement('h3'); h.textContent = it.nome;
            const p = document.createElement('p'); p.textContent = it.detalhe || '';
            card.append(ic, h, p);
            box.appendChild(card);
        });
    }

    // faixa correndo no topo: frases geradas da configuração (cópias repetidas para emendar sem pulo)
    function montarFaixa() {
        const quando = sorteio.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) +
            ' às ' + sorteio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).replace(':00', 'h');
        const frases = [
            C.titulo,
            C.premio.subtitulo,
            C.premio.itens.map((it) => it.nome).join(' · '),
            'Sorteio ' + quando,
        ].filter(Boolean);
        const trilho = $('faixa');
        trilho.textContent = '';
        for (let copia = 0; copia < 4; copia++) {
            frases.forEach((f) => { const sp = document.createElement('span'); sp.textContent = f; trilho.appendChild(sp); });
        }
    }

    // ---------------------------------------------------------------- contagem
    let intervalo;
    function atualizarContagem() {
        const diff = sorteio - new Date();
        if (diff <= 0) {
            clearInterval(intervalo);
            mostrarPosSorteio();
            return;
        }
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        $('days').textContent = String(d).padStart(2, '0');
        $('hours').textContent = String(h).padStart(2, '0');
        $('minutes').textContent = String(m).padStart(2, '0');
        $('seconds').textContent = String(s).padStart(2, '0');
    }

    function mostrarPosSorteio() {
        $('cd-titulo').textContent = 'Sorteio realizado!';
        $('timer').hidden = true;
        $('data-sorteio').textContent = 'Obrigado a todos que participaram!';
        const r = C.resultado || {};
        if (r.numero) {
            const box = $('resultado');
            box.textContent = '';
            const k = document.createElement('p'); k.textContent = 'Número sorteado';
            const n = document.createElement('p'); n.className = 'grande'; n.textContent = r.numero;
            box.append(k, n);
            if (r.ganhador) {
                const g = document.createElement('p'); g.textContent = 'Parabéns, ' + r.ganhador + '!';
                box.appendChild(g);
            }
            box.hidden = false;
        }
    }

    // ---------------------------------------------------------------- progresso
    function aplicarStatus(data) {
        estado = {
            total: data.total || C.totalNumeros,
            ocupados: (data.ocupadosLista || []).length,
            carregado: true,
        };
        desenharProgresso();
    }

    function desenharProgresso() {
        const total = estado.total;
        const ocup = estado.ocupados;
        const livres = Math.max(total - ocup, 0);
        const pctOcup = total ? (ocup / total) * 100 : 0;

        $('bar-pago').style.width = pctOcup.toFixed(2) + '%';
        $('bar').setAttribute('aria-valuenow', Math.round(pctOcup));
        $('pg-num').textContent = ocup + ' de ' + total;

        const metas = $('bar-metas');
        metas.textContent = '';
        (C.metas || []).forEach((m) => {
            const i = document.createElement('i');
            i.style.left = m + '%';
            if (pctOcup >= m) i.className = 'ok';
            metas.appendChild(i);
        });

        const msg = $('pg-msg');
        msg.textContent = '';
        const forte = document.createElement('span');
        const det = document.createElement('small');
        if (sorteio <= new Date()) {
            forte.textContent = ocup + ' números escolhidos';
            det.textContent = 'Obrigado a todos que participaram!';
        } else if (livres === 0) {
            forte.textContent = 'Todos os números já foram escolhidos! 🎉';
            det.textContent = 'Obrigado a todos que participaram!';
        } else if (pctOcup >= 90) {
            forte.textContent = 'Últimos números! Restam só ' + livres + '.';
            det.textContent = 'Fale com um vendedor antes que acabe.';
        } else {
            forte.textContent = livres + ' números ainda livres!';
            const proxima = (C.metas || []).find((m) => pctOcup < m);
            const batida = (C.metas || []).filter((m) => pctOcup >= m).pop();
            const partes = [];
            if (batida) partes.push('🎉 Já passamos de ' + batida + '%');
            if (proxima) {
                const faltam = Math.ceil((proxima / 100) * total) - ocup;
                partes.push('próxima meta: ' + proxima + '% (faltam ' + faltam + ')');
            }
            det.textContent = partes.join(' · ');
        }
        msg.append(forte, det);
    }


    // ---------------------------------------------------------------- janelas
    let ultimoFoco = null;
    function abrir(el) {
        ultimoFoco = document.activeElement;
        el.hidden = false;
        const alvo = el.querySelector('input, a.btn, button.fechar');
        if (alvo) alvo.focus();
    }
    function fechar(el) {
        el.hidden = true;
        if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus();
    }
    document.querySelectorAll('.modal').forEach((el) => {
        el.addEventListener('click', (e) => {
            if (e.target === el || e.target.closest('[data-fechar]')) fechar(el);
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('.modal:not([hidden])').forEach(fechar);
    });

    // ---------------------------------------------------------------- consulta
    function mostrarConsulta(nodos) {
        const box = $('resultado-consulta');
        box.textContent = '';
        nodos.forEach((n) => box.appendChild(n));
    }
    function p(txt, cls) {
        const e = document.createElement('p');
        if (cls) e.className = cls;
        e.textContent = txt;
        return e;
    }

    async function consultar(e) {
        e.preventDefault();
        const contato = $('consulta-contato').value.trim();
        const nasc = $('consulta-nascimento').value;
        if (!contato || !nasc) {
            mostrarConsulta([p('Preencha o e-mail ou telefone e a data de nascimento.', 'erro')]);
            return;
        }
        const btn = $('btn-buscar');
        btn.disabled = true; btn.textContent = 'Buscando…';
        mostrarConsulta([]);
        const r = await API.post({ action: 'consult', contato: contato, nascimento: nasc }, 'Buscando seus números…');
        btn.disabled = false; btn.textContent = 'Buscar';
        if (!r.ok) {
            mostrarConsulta([p(r.erro || 'Erro ao buscar. Tente de novo.', 'erro')]);
            return;
        }
        if (!r.numeros.length) {
            mostrarConsulta([p('Nenhum número encontrado com esses dados. Confira se digitou igual ao informado no cadastro ou fale com seu vendedor.')]);
            return;
        }
        const nums = document.createElement('div');
        nums.className = 'nums';
        r.numeros.forEach((n) => {
            const s = document.createElement('span');
            s.textContent = n;
            nums.appendChild(s);
        });
        mostrarConsulta([p(r.numeros.length > 1 ? 'Seus números da sorte:' : 'Seu número da sorte:'), nums]);
    }

    // ---------------------------------------------------------------- carga
    async function carregar() {
        const r = await API.status();
        if (r && r.ok) {
            aplicarStatus(r);
            Util.gravarCache(CACHE_KEY, r);
        } else if (!estado.carregado) {
            $('pg-msg').textContent = 'Não foi possível carregar os números agora. Tente recarregar a página.';
        }
    }

    // eventos
    $('btn-consultar').addEventListener('click', () => abrir($('modal-consulta')));
    $('form-consulta').addEventListener('submit', consultar);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(); });
    setInterval(() => { if (!document.hidden) carregar(); }, 60000);

    // início: mostra na hora o último valor conhecido e atualiza em seguida
    preencherTextos();
    if (sorteio > new Date()) intervalo = setInterval(atualizarContagem, 1000);
    atualizarContagem();
    const cache = Util.lerCache(CACHE_KEY);
    if (cache && cache.ok) aplicarStatus(cache);
    carregar();
})();
