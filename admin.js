(function () {
    'use strict';
    const C = window.CONFIG;
    const $ = (id) => document.getElementById(id);
    const PIN_KEY = 'rifa-' + C.ano + '-pin';

    let pin = '';
    let vendedor = null;          // {nome, perfil}
    let dados = { vendas: [], ranking: [], total: C.totalNumeros, maxPorCadastro: 50 };
    let publico = { total: C.totalNumeros, ocupados: new Set() };
    let filtro = { st: '', busca: '', vendedor: '' };
    let abaAtual = 'venda';
    let ultimoParticipante = null;

    // ------------------------------------------------------------ util
    function el(tag, cls, txt) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt != null) e.textContent = txt;
        return e;
    }
    let toastT;
    function toast(msg, erro) {
        const t = $('toast');
        t.textContent = msg;
        t.className = 'toast' + (erro ? ' erro' : '');
        t.hidden = false;
        clearTimeout(toastT);
        toastT = setTimeout(() => { t.hidden = true; }, 3500);
    }
    function msg(id, texto, tipo) {
        const m = $(id);
        m.textContent = texto || '';
        m.className = 'msg' + (tipo ? ' ' + tipo : '');
    }
    // Horário de Brasília (UTC-3, sem horário de verão), qualquer que seja o fuso do aparelho
    const FUSO = 'America/Sao_Paulo';
    function dataBR(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO }) + ' ' +
            d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO });
    }
    const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
    const isAdmin = () => vendedor && vendedor.perfil === 'admin';

    /** Trata respostas: PIN inválido volta para o login. */
    function tratar(r) {
        if (r && r.auth) {
            sair(r.erro);
            return false;
        }
        return true;
    }

    // ------------------------------------------------------------ login
    async function entrar(pinDigitado, silencioso) {
        const btn = $('btn-entrar');
        btn.disabled = true; btn.textContent = 'Entrando…';
        if (!silencioso) msg('login-msg', '');
        const r = await API.post({ action: 'list', pin: pinDigitado }, silencioso ? 'Verificando acesso…' : 'Entrando…');
        btn.disabled = false; btn.textContent = 'Entrar';
        if (!r.ok) {
            if (r.auth) { try { localStorage.removeItem(PIN_KEY); } catch (e) { /* */ } }
            msg('login-msg', r.erro || 'Não foi possível entrar.', 'erro');
            $('tela-login').hidden = false;
            $('app').hidden = true;
            return;
        }
        pin = pinDigitado;
        if ($('lembrar').checked) { try { localStorage.setItem(PIN_KEY, pin); } catch (e) { /* */ } }
        vendedor = r.vendedor;
        $('pin').value = '';
        $('tela-login').hidden = true;
        $('app').hidden = false;
        $('quem-nome').textContent = vendedor.nome;
        $('quem-perfil').textContent = isAdmin() ? 'admin' : 'vendedor';
        $('quem-perfil').className = 'pill' + (isAdmin() ? ' admin' : '');
        $('aba-vendas-txt').textContent = isAdmin() ? 'Todos os cadastros' : 'Meus cadastros';
        $('f-vendedor').hidden = !isAdmin();
        $('btn-csv').hidden = !isAdmin();
        $('aba-btn-equipe').hidden = !isAdmin();
        aplicarLista(r);
        $('v-nome').focus();
    }

    function sair(motivo) {
        pin = ''; vendedor = null;
        sync = { em: 0, rodando: null, erro: false };
        try { localStorage.removeItem(PIN_KEY); } catch (e) { /* */ }
        irPara('venda');
        $('aba-btn-equipe').hidden = true;
        $('pin-novo').hidden = true;
        $('equipe-lista').textContent = '';
        $('app').hidden = true;
        $('tela-login').hidden = false;
        msg('login-msg', motivo || '', motivo ? 'erro' : '');
        $('pin').focus();
    }

    // ------------------------------------------------------------ dados
    function aplicarPublico(p) {
        if (!p || !p.ok) return;
        publico = { total: p.total, ocupados: new Set(p.ocupadosLista || []) };
        $('prog-mini').textContent = publico.ocupados.size + '/' + publico.total;
        atualizarChips();
        if (!$('mini-grade').hidden) desenharMiniGrade();
    }

    /** Aplica tudo o que veio do servidor (cadastros, ranking, números ocupados e, para admin, a equipe). */
    function aplicarLista(r) {
        dados = { vendas: r.vendas || [], ranking: r.ranking || [], total: r.total, maxPorCadastro: r.maxPorCadastro || 50 };
        $('v-qtd').max = dados.maxPorCadastro;
        aplicarPublico(r.publico);
        preencherFiltroVendedor();
        desenharVendas();
        desenharRanking();
        if (r.usuarios) desenharEquipe(r.usuarios);
        marcarSync(true);
    }

    // ------------------------------------------------------------ sincronização
    // Os dados ficam na memória: trocar de aba é instantâneo. A sincronização com a planilha
    // roda em segundo plano (sem travar a tela) ao trocar de aba se estiverem velhos, a cada
    // minuto, ao voltar para o app e no botão do topo. Só ações que gravam travam a tela.
    const VELHO_MS = 30000;
    let sync = { em: 0, rodando: null, erro: false };
    // Sobe a cada gravação. Uma sincronização que começou antes dela traz dados velhos:
    // a resposta é descartada e outra sincronização é feita em seguida.
    let gravacoes = 0;
    const vaiGravar = () => { gravacoes++; };

    function marcarSync(ok) {
        if (ok) { sync.em = Date.now(); sync.erro = false; } else sync.erro = true;
        desenharSync();
    }

    function desenharSync() {
        const b = $('btn-sync');
        b.classList.toggle('girando', !!sync.rodando);
        b.classList.toggle('falhou', sync.erro && !sync.rodando);
        let txt;
        if (sync.rodando) txt = 'Sincronizando…';
        else if (sync.erro) txt = 'Sem conexão';
        else if (!sync.em) txt = 'Sincronizar';
        else {
            const min = Math.floor((Date.now() - sync.em) / 60000);
            txt = min < 1 ? 'Atualizado agora' : 'Atualizado há ' + min + ' min';
        }
        $('sync-txt').textContent = txt;
        b.title = txt + (sync.rodando ? '' : ' · toque para sincronizar');
        b.setAttribute('aria-label', b.title);
    }

    /** Busca tudo de novo. `manual`: avisa o resultado. Pedidos repetidos reaproveitam o que já está em andamento. */
    function sincronizar(manual) {
        if (!pin) return Promise.resolve();
        if (sync.rodando) return sync.rodando;
        const pinDoPedido = pin;
        const gravacoesAntes = gravacoes;
        let refazer = false;
        sync.rodando = (async () => {
            const r = await API.post({ action: 'list', pin: pinDoPedido });
            if (pin !== pinDoPedido) return; // saiu (ou trocou de vendedor) enquanto carregava
            if (gravacoes !== gravacoesAntes) { refazer = true; return; }
            if (!tratar(r)) return;
            if (!r.ok) { marcarSync(false); if (manual) toast(r.erro || 'Não foi possível sincronizar.', true); return; }
            aplicarLista(r);
            if (manual) toast('Tudo sincronizado');
        })().finally(() => {
            sync.rodando = null;
            desenharSync();
            if (refazer) sincronizar(manual);
        });
        desenharSync();
        return sync.rodando;
    }

    const dadosVelhos = () => Date.now() - sync.em > VELHO_MS;

    // ------------------------------------------------------------ abas
    function irPara(aba) {
        abaAtual = aba;
        document.querySelectorAll('.abas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === aba)));
        ['venda', 'vendas', 'ranking', 'equipe'].forEach((a) => { $('aba-' + a).hidden = a !== aba; });
        if (pin && dadosVelhos()) sincronizar(false); // mostra o que já tem e atualiza por trás
    }
    document.querySelectorAll('.abas button').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.aba)));

    // ------------------------------------------------------------ novo cadastro
    /** Quantidade que o vendedor informou (0 = vazio/inválido). */
    function quantidade() {
        const v = $('v-qtd').value.trim();
        const n = Number(v);
        return /^\d+$/.test(v) && n >= 1 ? n : 0;
    }

    /** "12, 15 40-42" → {validos:[12,15,40,41,42], fora:[...], invalidos:[...]} */
    function lerNumeros(texto) {
        const nums = [], invalidos = [];
        String(texto).split(/[\s,;]+/).filter(Boolean).forEach((tok) => {
            const faixa = tok.match(/^(\d+)-(\d+)$/);
            if (faixa) {
                let a = +faixa[1], b = +faixa[2];
                if (a > b) [a, b] = [b, a];
                if (b - a >= dados.maxPorCadastro) { invalidos.push(tok); return; }
                for (let n = a; n <= b; n++) nums.push(n);
            } else if (/^\d+$/.test(tok)) {
                nums.push(+tok);
            } else {
                invalidos.push(tok);
            }
        });
        const unicos = nums.filter((n, i) => nums.indexOf(n) === i);
        return {
            validos: unicos.filter((n) => n >= 1 && n <= publico.total),
            fora: unicos.filter((n) => n < 1 || n > publico.total),
            invalidos: invalidos,
        };
    }

    function removerNumero(n) {
        const r = lerNumeros($('v-numeros').value);
        $('v-numeros').value = r.validos.filter((x) => x !== n).join(', ');
        atualizarChips();
        if (!$('mini-grade').hidden) desenharMiniGrade();
    }

    function atualizarChips() {
        const box = $('chips');
        box.textContent = '';
        const r = lerNumeros($('v-numeros').value);
        let ocupados = 0;
        r.validos.forEach((n) => {
            const ocup = publico.ocupados.has(n);
            if (ocup) ocupados++;
            const c = el('span', 'chip' + (ocup ? ' ocupado' : ''), (ocup ? '✕ ' : '') + n);
            c.title = ocup ? 'Já escolhido por outra pessoa' : 'Livre';
            const x = el('button', null, '×');
            x.type = 'button';
            x.setAttribute('aria-label', 'Remover ' + n);
            x.addEventListener('click', () => removerNumero(n));
            c.appendChild(x);
            box.appendChild(c);
        });
        r.fora.concat(r.invalidos).forEach((t) => {
            const c = el('span', 'chip invalido', String(t));
            c.title = 'Fora de 1 a ' + publico.total;
            box.appendChild(c);
        });

        const alvo = quantidade();
        const max = dados.maxPorCadastro;
        const qtd = r.validos.length;
        const problemas = [];
        if (ocupados) problemas.push(ocupados + ' já escolhido(s) por outra pessoa');
        if (r.fora.length || r.invalidos.length) problemas.push('números inválidos');
        let txt;
        if (!alvo) {
            txt = 'Informe a quantidade de números' + (qtd ? ' (' + plural(qtd, 'escolhido', 'escolhidos') + ')' : '');
        } else if (alvo > max) {
            txt = 'Máximo de ' + max + ' números por cadastro';
            problemas.push('');
        } else {
            txt = qtd + ' de ' + alvo + (alvo === 1 ? ' escolhido' : ' escolhidos');
            if (qtd < alvo) txt += ' · falta' + (alvo - qtd > 1 ? 'm ' : ' ') + (alvo - qtd);
            else if (qtd > alvo) { txt += ' · tire ' + (qtd - alvo); problemas.push(''); }
            else if (!problemas.length) txt += ' ✓';
        }
        const extra = problemas.filter(Boolean);
        if (extra.length) txt += ' · ' + extra.join(', ');
        const pronto = alvo >= 1 && alvo <= max && qtd === alvo && !problemas.length;
        $('resumo').textContent = txt;
        $('resumo').className = pronto ? 'ok' : '';
        $('resumo').style.color = problemas.length ? 'var(--vermelho)' : '';
        $('btn-registrar').disabled = !pronto;
        $('mini-grade').classList.toggle('cheia', alvo > 0 && qtd >= alvo);
    }

    function desenharMiniGrade() {
        const g = $('mini-grade');
        const sel = new Set(lerNumeros($('v-numeros').value).validos);
        const frag = document.createDocumentFragment();
        for (let n = 1; n <= publico.total; n++) {
            const b = el('button', sel.has(n) ? 'sel' : '', String(n));
            b.type = 'button';
            b.dataset.n = n;
            if (publico.ocupados.has(n) && !sel.has(n)) b.disabled = true;
            frag.appendChild(b);
        }
        g.textContent = '';
        g.appendChild(frag);
    }

    $('mini-grade').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-n]');
        if (!b || b.disabled) return;
        const n = Number(b.dataset.n);
        const atuais = lerNumeros($('v-numeros').value).validos;
        const tirar = atuais.includes(n);
        if (!tirar) {
            const alvo = quantidade();
            if (!alvo) { toast('Primeiro informe quantos números a pessoa vai escolher.', true); $('v-qtd').focus(); return; }
            if (atuais.length >= alvo) { toast('Já são ' + plural(alvo, 'número', 'números') + '. Desmarque um para trocar.', true); return; }
        }
        $('v-numeros').value = (tirar ? atuais.filter((x) => x !== n) : atuais.concat(n)).join(', ');
        b.classList.toggle('sel', !tirar);
        atualizarChips();
    });
    $('btn-grade').addEventListener('click', () => {
        const g = $('mini-grade');
        g.hidden = !g.hidden;
        $('btn-grade').setAttribute('aria-expanded', String(!g.hidden));
        $('btn-grade').textContent = g.hidden ? 'Escolher na grade' : 'Fechar grade';
        if (!g.hidden) desenharMiniGrade();
    });
    $('v-numeros').addEventListener('input', () => {
        atualizarChips();
        if (!$('mini-grade').hidden) desenharMiniGrade();
    });
    $('v-qtd').addEventListener('input', atualizarChips);
    function passoQtd(d) {
        const n = Math.min(dados.maxPorCadastro, Math.max(1, quantidade() + d));
        $('v-qtd').value = n;
        atualizarChips();
    }
    $('qtd-menos').addEventListener('click', () => passoQtd(-1));
    $('qtd-mais').addEventListener('click', () => passoQtd(1));
    $('v-telefone').addEventListener('input', (e) => { e.target.value = Util.mascaraTelefone(e.target.value); });

    async function registrar(e) {
        e.preventDefault();
        const nome = $('v-nome').value.trim();
        const tel = $('v-telefone').value.replace(/\D/g, '');
        const email = $('v-email').value.trim();
        const nasc = $('v-nasc').value;
        const alvo = quantidade();
        const nums = lerNumeros($('v-numeros').value).validos;

        if (!nome) return msg('venda-msg', 'Informe o nome do participante.', 'erro'), $('v-nome').focus();
        if (tel.length < 10) return msg('venda-msg', 'Telefone incompleto: use DDD + número.', 'erro'), $('v-telefone').focus();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg('venda-msg', 'E-mail inválido.', 'erro'), $('v-email').focus();
        if (!nasc) return msg('venda-msg', 'Informe a data de nascimento.', 'erro'), $('v-nasc').focus();
        if (!alvo) return msg('venda-msg', 'Informe quantos números a pessoa vai escolher.', 'erro'), $('v-qtd').focus();
        if (nums.length !== alvo) return msg('venda-msg', 'Escolha exatamente ' + plural(alvo, 'número', 'números') + '.', 'erro'), $('v-numeros').focus();

        const btn = $('btn-registrar');
        btn.disabled = true; btn.textContent = 'Registrando…';
        msg('venda-msg', '');
        const pinDoPedido = pin;
        vaiGravar();
        const r = await API.post({ action: 'register', pin: pinDoPedido, nome: nome, telefone: tel, email: email, nascimento: nasc, quantidade: alvo, numeros: nums },
            'Registrando ' + plural(alvo, 'número', 'números') + '…');
        btn.textContent = 'Registrar';
        if (pin !== pinDoPedido) return;
        if (!tratar(r)) return;
        if (!r.ok) {
            msg('venda-msg', r.erro || 'Erro ao registrar.', 'erro');
            if (r.ocupados) {
                r.ocupados.forEach((n) => publico.ocupados.add(n)); // marca na hora
                if (!$('mini-grade').hidden) desenharMiniGrade();
                sincronizar(false);
            }
            atualizarChips();
            return;
        }
        ultimoParticipante = { nome: nome, tel: $('v-telefone').value, email: email, nasc: nasc };
        aplicarPublico(r.publico);
        $('form-venda').hidden = true;
        $('sucesso').hidden = false;
        const lista = r.numeros.slice().sort((a, b) => a - b).join(', ');
        $('sucesso-txt').textContent = nome + ': ' + (r.numeros.length > 1 ? 'números ' : 'número ') + lista +
            (r.emailEnviado ? ' · confirmação enviada por e-mail.' : '.');
        $('sucesso-aviso').textContent = r.aviso || '';
        $('sucesso-aviso').hidden = !r.aviso;
        $('btn-nova').focus();
        sincronizar(false); // traz o cadastro novo para a lista e o ranking, por trás
    }

    function limparVenda(manterParticipante) {
        $('form-venda').reset();
        if (manterParticipante && ultimoParticipante) {
            $('v-nome').value = ultimoParticipante.nome;
            $('v-telefone').value = ultimoParticipante.tel;
            $('v-email').value = ultimoParticipante.email;
            $('v-nasc').value = ultimoParticipante.nasc;
        }
        msg('venda-msg', '');
        $('sucesso').hidden = true;
        $('form-venda').hidden = false;
        atualizarChips();
        if (!$('mini-grade').hidden) desenharMiniGrade();
        (manterParticipante ? $('v-qtd') : $('v-nome')).focus();
    }
    $('form-venda').addEventListener('submit', registrar);
    $('btn-nova').addEventListener('click', () => limparVenda(false));
    $('btn-mesmo').addEventListener('click', () => limparVenda(true));

    // ------------------------------------------------------------ cadastros
    function preencherFiltroVendedor() {
        const sel = $('f-vendedor');
        const atual = sel.value;
        const nomes = [...new Set(dados.vendas.map((v) => v.vendedor).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        sel.length = 1;
        nomes.forEach((n) => sel.add(new Option(n, n)));
        sel.value = nomes.includes(atual) ? atual : '';
    }

    function vendasFiltradas() {
        const q = filtro.busca.toLowerCase();
        const qDig = q.replace(/\D/g, '');
        return dados.vendas.filter((v) =>
            (!filtro.st || v.status === filtro.st) &&
            (!filtro.vendedor || v.vendedor === filtro.vendedor) &&
            (!q || v.nome.toLowerCase().includes(q) || String(v.numero) === q || (qDig.length >= 4 && v.telefone.includes(qDig)) || v.email.includes(q)));
    }

    function desenharKpis() {
        const base = dados.vendas.filter((v) => !filtro.vendedor || v.vendedor === filtro.vendedor);
        const ativos = base.filter((v) => v.status === 'ATIVO');
        const pessoas = new Set(ativos.map((v) => v.telefone || v.nome)).size;
        const cancelados = base.length - ativos.length;
        const k = [
            ['vd', String(ativos.length), ativos.length === 1 ? 'número cadastrado' : 'números cadastrados'],
            ['', String(pessoas), pessoas === 1 ? 'pessoa' : 'pessoas'],
        ];
        if (isAdmin() && !filtro.vendedor) {
            k.push(['', String(publico.total - publico.ocupados.size), 'números livres']);
        }
        k.push(['', String(cancelados), cancelados === 1 ? 'cancelado' : 'cancelados']);
        const box = $('kpis');
        box.textContent = '';
        k.forEach(([cls, v, l]) => {
            const d = el('div', 'kpi ' + cls);
            d.append(el('div', 'v', v), el('div', 'l', l));
            box.appendChild(d);
        });
    }

    function botao(txt, cls, fn) {
        const b = el('button', 'btn peq ' + cls, txt);
        b.type = 'button';
        b.addEventListener('click', fn);
        return b;
    }

    async function mudarStatus(v, novo, b) {
        const texto = novo === 'CANCELADO'
            ? 'Cancelar o número ' + v.numero + ' de ' + v.nome + '? Ele volta a ficar livre.'
            : 'Reativar o número ' + v.numero + ' para ' + v.nome + '?';
        if (!confirm(texto)) return;
        b.disabled = true;
        const pinDoPedido = pin;
        vaiGravar();
        const r = await API.post({ action: 'setStatus', pin: pinDoPedido, linha: v.linha, numero: v.numero, status: novo },
            (novo === 'CANCELADO' ? 'Cancelando' : 'Reativando') + ' o número ' + v.numero + '…');
        if (pin !== pinDoPedido) return;
        if (!tratar(r)) return;
        if (!r.ok) { b.disabled = false; toast(r.erro || 'Erro ao atualizar.', true); return; }
        aplicarLista(r);
        toast(novo === 'CANCELADO' ? 'Número ' + v.numero + ' liberado' : 'Número ' + v.numero + ' reativado');
    }

    function desenharVendas() {
        desenharKpis();
        const lista = $('lista');
        lista.textContent = '';
        const itens = vendasFiltradas();
        $('contagem').textContent = plural(itens.length, 'registro', 'registros');
        if (!itens.length) {
            lista.appendChild(el('p', 'vazio', dados.vendas.length ? 'Nenhum cadastro com esses filtros.' : 'Nenhum cadastro ainda. 🎄'));
            return;
        }
        const frag = document.createDocumentFragment();
        itens.forEach((v) => {
            const card = el('article', 'venda ' + v.status);
            const info = el('div');
            info.appendChild(el('div', 'nome', v.nome));
            const meta = el('div', 'meta');
            if (v.telefone) {
                const a = el('a', null, Util.mascaraTelefone(v.telefone));
                a.href = Util.linkWhatsapp(v.telefone);
                a.target = '_blank'; a.rel = 'noopener';
                meta.appendChild(a);
            }
            if (v.email) meta.appendChild(el('span', null, v.email));
            meta.appendChild(el('span', null, dataBR(v.data)));
            if (isAdmin()) meta.appendChild(el('span', null, '👤 ' + (v.vendedor || '—')));
            info.appendChild(meta);
            if (v.status === 'CANCELADO') {
                const tags = el('div', 'tags');
                tags.appendChild(el('span', 'tag CANCELADO', 'cancelado'));
                info.appendChild(tags);
            }
            card.append(el('div', 'num', String(v.numero)), info);

            const acoes = el('div', 'acoes');
            const meu = v.vendedor === vendedor.nome;
            if (v.status === 'ATIVO' && (meu || isAdmin())) {
                acoes.appendChild(botao('Cancelar', 'btn-perigo', (e) => mudarStatus(v, 'CANCELADO', e.currentTarget)));
            } else if (v.status === 'CANCELADO' && isAdmin()) {
                acoes.appendChild(botao('Reativar', 'btn-sec', (e) => mudarStatus(v, 'ATIVO', e.currentTarget)));
            }
            if (acoes.childNodes.length) card.appendChild(acoes);
            frag.appendChild(card);
        });
        lista.appendChild(frag);
    }

    $('f-busca').addEventListener('input', (e) => { filtro.busca = e.target.value.trim(); desenharVendas(); });
    $('f-vendedor').addEventListener('change', (e) => { filtro.vendedor = e.target.value; desenharVendas(); });
    $('f-status').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-st]');
        if (!b) return;
        filtro.st = b.dataset.st;
        $('f-status').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        desenharVendas();
    });

    $('btn-csv').addEventListener('click', () => {
        const cab = ['Número', 'Status', 'Nome', 'Telefone', 'E-mail', 'Vendedor', 'Data'];
        const linhas = vendasFiltradas().map((v) => [v.numero, v.status, v.nome, v.telefone, v.email, v.vendedor, dataBR(v.data)]);
        const csv = [cab].concat(linhas).map((l) => l.map((c) => {
            let s = String(c == null ? '' : c);
            if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmula ao abrir no Excel
            return '"' + s.replace(/"/g, '""') + '"';
        }).join(';')).join('\r\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'rifa-' + C.ano + '-cadastros.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    // ------------------------------------------------------------ ranking
    function desenharRanking() {
        const ol = $('ranking');
        ol.textContent = '';
        const rk = dados.ranking;
        if (!rk.length) { ol.appendChild(el('li', 'vazio', 'Ainda sem cadastros.')); return; }
        const max = Math.max(1, ...rk.map((r) => r.numeros));
        const medalhas = ['🥇', '🥈', '🥉'];
        rk.forEach((r, i) => {
            const li = el('li', vendedor && r.nome === vendedor.nome ? 'eu' : '');
            li.appendChild(el('span', 'pos', r.numeros ? (medalhas[i] || String(i + 1)) : String(i + 1)));
            li.appendChild(el('span', 'rn', r.nome));
            const rv = el('span', 'rv', String(r.numeros));
            rv.appendChild(el('small', null, ' · ' + plural(r.pessoas, 'pessoa', 'pessoas')));
            li.appendChild(rv);
            const bar = el('div', 'rbar');
            const a = el('i'); a.style.width = (r.numeros / max * 100) + '%';
            bar.appendChild(a);
            li.appendChild(bar);
            ol.appendChild(li);
        });
    }

    // ------------------------------------------------------------ equipe (só admin)
    let pinMostrado = null; // { nome, pin }

    function mensagemPin(nome, p) {
        return 'Olá, ' + nome + '! Seu acesso ao Sistema da Rifa Natal Solidário:\n' +
            (C.urlSistema || location.href.split('#')[0]) + '\n\nSeu PIN: ' + p + '\n\nNão passe o PIN para ninguém.';
    }

    function mostrarPin(nome, p) {
        pinMostrado = { nome: nome, pin: p };
        $('pin-novo-quem').textContent = 'PIN de ' + nome;
        $('pin-novo-num').textContent = p;
        $('btn-pin-zap').href = 'https://wa.me/?text=' + encodeURIComponent(mensagemPin(nome, p));
        $('pin-novo').hidden = false;
        $('pin-novo').scrollIntoView({ behavior: 'smooth', block: 'center' });
        $('btn-pin-copiar').focus();
    }

    async function copiar(texto) {
        try { await navigator.clipboard.writeText(texto); return true; } catch (e) { /* tenta o jeito antigo */ }
        const t = document.createElement('textarea');
        t.value = texto; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { /* */ }
        t.remove();
        return ok;
    }

    /** Chamada de equipe: trata PIN expirado, mostra erro e redesenha a lista. */
    async function pedidoEquipe(body, espera) {
        const pinDoPedido = pin;
        vaiGravar();
        const r = await API.post(Object.assign({ pin: pinDoPedido }, body), espera);
        if (pin !== pinDoPedido) return null;
        if (!tratar(r)) return null;
        if (!r.ok) { toast(r.erro || 'Não foi possível concluir.', true); return null; }
        if (r.usuarios) desenharEquipe(r.usuarios);
        return r;
    }

    function desenharEquipe(usuarios) {
        const box = $('equipe-lista');
        box.textContent = '';
        if (!usuarios.length) { box.appendChild(el('p', 'vazio', 'Ninguém cadastrado ainda.')); return; }
        usuarios.forEach((u) => {
            const eu = vendedor && u.nome === vendedor.nome;
            const li = el('div', 'membro' + (u.ativo ? '' : ' inativo'));
            const nome = el('div', 'm-nome', u.nome + (eu ? ' (você)' : ''));
            nome.appendChild(el('span', 'pill' + (u.perfil === 'admin' ? ' admin' : ''), u.perfil === 'admin' ? 'admin' : 'vendedor'));
            if (!u.ativo) nome.appendChild(el('span', 'pill off', 'desativado'));
            li.appendChild(nome);
            li.appendChild(el('div', 'm-meta', plural(u.numeros, 'número cadastrado', 'números cadastrados')));

            const acoes = el('div', 'acoes');
            acoes.appendChild(botao('Novo PIN', 'btn-sec', () => gerarNovoPin(u)));
            if (!eu) {
                acoes.appendChild(u.perfil === 'admin'
                    ? botao('Tornar vendedor', 'btn-sec', () => alterarUsuario(u, { perfil: 'vendedor' }, 'Tirar o acesso de administrador de ' + u.nome + '?', 'Atualizando…'))
                    : botao('Tornar admin', 'btn-sec', () => alterarUsuario(u, { perfil: 'admin' }, 'Dar acesso de administrador a ' + u.nome + '? A pessoa vai ver todos os cadastros e poderá gerenciar a equipe.', 'Atualizando…')));
                acoes.appendChild(u.ativo
                    ? botao('Desativar', 'btn-perigo', () => alterarUsuario(u, { ativo: false }, 'Desativar ' + u.nome + '? O PIN para de funcionar, mas os cadastros continuam valendo.', 'Desativando…'))
                    : botao('Reativar', 'btn-ok', () => alterarUsuario(u, { ativo: true }, null, 'Reativando…')));
            }
            li.appendChild(acoes);
            box.appendChild(li);
        });
    }

    async function alterarUsuario(u, mudanca, pergunta, espera) {
        if (pergunta && !confirm(pergunta)) return;
        const r = await pedidoEquipe(Object.assign({ action: 'setUser', nome: u.nome }, mudanca), espera);
        if (r) toast(u.nome + ': alteração salva');
    }

    async function gerarNovoPin(u) {
        const eu = vendedor && u.nome === vendedor.nome;
        if (!confirm('Gerar um PIN novo para ' + u.nome + '? O PIN atual para de funcionar na hora.' +
            (eu ? ' (É o seu PIN: anote o novo.)' : ''))) return;
        const r = await pedidoEquipe({ action: 'resetPin', nome: u.nome }, 'Gerando PIN novo…');
        if (!r) return;
        if (eu) { // continua logado com o PIN novo
            pin = r.pin;
            try { if (localStorage.getItem(PIN_KEY)) localStorage.setItem(PIN_KEY, r.pin); } catch (e) { /* */ }
        }
        mostrarPin(r.nome, r.pin);
    }

    $('form-equipe').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = $('u-nome').value.trim();
        if (nome.length < 2) { msg('equipe-msg', 'Informe o nome da pessoa.', 'erro'); $('u-nome').focus(); return; }
        msg('equipe-msg', '');
        const r = await pedidoEquipe({ action: 'addUser', nome: nome, perfil: $('u-perfil').value }, 'Cadastrando ' + nome + '…');
        if (!r) return;
        $('form-equipe').reset();
        mostrarPin(r.nome, r.pin);
    });
    $('btn-pin-copiar').addEventListener('click', async () => {
        if (!pinMostrado) return;
        const ok = await copiar(mensagemPin(pinMostrado.nome, pinMostrado.pin));
        toast(ok ? 'Mensagem copiada' : 'Não deu para copiar: anote o PIN', !ok);
    });
    $('btn-pin-ok').addEventListener('click', () => {
        pinMostrado = null;
        $('pin-novo').hidden = true;
        $('pin-novo-num').textContent = '';
        $('u-nome').focus();
    });

    // ------------------------------------------------------------ início
    $('form-login').addEventListener('submit', (e) => {
        e.preventDefault();
        const p = $('pin').value.trim();
        if (p.length < 4) { msg('login-msg', 'Digite o seu PIN.', 'erro'); return; }
        entrar(p, false);
    });
    $('btn-sair').addEventListener('click', () => sair(''));

    // mantém tudo atualizado enquanto o painel está aberto (sem travar a tela)
    $('btn-sync').addEventListener('click', () => sincronizar(true));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && pin && dadosVelhos()) sincronizar(false);
    });
    setInterval(() => { if (!document.hidden && pin) sincronizar(false); }, 60000);
    setInterval(() => { if (pin) desenharSync(); }, 20000); // "atualizado há X min"

    let salvo = '';
    try { salvo = localStorage.getItem(PIN_KEY) || ''; } catch (e) { /* */ }
    if (salvo) entrar(salvo, true);
    else $('pin').focus();
})();
