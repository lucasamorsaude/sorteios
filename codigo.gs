/**
 * Sorteio Black November CDT e AS: servidor do sorteio (Google Apps Script)
 * ---------------------------------------------------------------------------
 * COMO PUBLICAR
 * 1. Cole este arquivo inteiro no editor do Apps Script (substituindo o antigo).
 * 2. Rode a função `setup` uma vez (menu Executar). Ela cria as abas
 *    "Rifa 2026" e "Vendedores" se não existirem e mostra o PIN do
 *    administrador no registro de execução.
 * 3. Implantar → Gerenciar implantações → (lápis) → Versão: "Nova versão" →
 *    Implantar. Assim a URL continua a mesma.
 *
 * VIRADA DE ANO: mude só o bloco CONFIG abaixo (e o config.js do site).
 * ---------------------------------------------------------------------------
 */
const CONFIG = {
  SPREADSHEET_ID: '1kl_hfJ8om28uKbdq5rWbkgA7Goc4QFkJgYiKDsP5xVA',
  ABA_VENDAS: 'Rifa 2026', // nome da aba na planilha: não renomeie (os cadastros estão nela)
  ABA_VENDEDORES: 'Vendedores',
  TOTAL_NUMEROS: 1000, // igual ao totalNumeros do config.js
  CAMPANHA: 'Sorteio Black November CDT e AS - SJDR',
  TITULO: 'Black November CDT e AS',            // nome curto (remetente e título do e-mail)
  SELO: 'Sorteio 2026',                         // etiqueta no topo do e-mail
  ORGANIZACAO: 'AS e CDT · São João del-Rei',
  PREMIO: 'Kit eletrodomésticos: batedeira, liquidificador, churrasqueira e misteira',
  DATA_SORTEIO_TEXTO: '04/12/2026 às 15h', // A DEFINIR: igual ao dataSorteio do config.js
  LINK_SITE: 'https://lucasamorsaude.github.io/sorteios/', // endereço do site (vai no e-mail)
  WHATSAPP_CONTATO: '553239380908', // igual ao whatsapp do config.js
  FUSO: 'America/Sao_Paulo', // UTC-3 (Brasília); o setup aplica este fuso na planilha
  MAX_NUMEROS_POR_CADASTRO: 50, // limite da quantidade que o vendedor pode dar a uma pessoa
  ENVIAR_EMAIL: true,
};

// Colunas da aba de cadastros (1 = A). Uma linha por número.
const COL = { DATA: 1, NOME: 2, TELEFONE: 3, EMAIL: 4, NASCIMENTO: 5, VENDEDOR: 6, NUMERO: 7, STATUS: 8, ATUALIZADO_EM: 9, ATUALIZADO_POR: 10 };
const N_COLS = 10;
const CABECALHO = ['Data', 'Nome', 'Telefone', 'E-mail', 'Nascimento', 'Vendedor', 'Número', 'Status', 'Atualizado em', 'Atualizado por'];
// Não há pagamento: o número vale assim que é cadastrado. CANCELADO libera o número.
// (Linhas antigas com PAGO ou RESERVADO são lidas como ATIVO.)
const STATUS = { ATIVO: 'ATIVO', CANCELADO: 'CANCELADO' };
const CACHE_STATUS = 'status_publico_v2';
const CACHE_FALHAS = 'pin_falhas';
const MAX_FALHAS_PIN = 30; // por 10 minutos, somando todos os aparelhos

// ===========================================================================
// Entrada
// ===========================================================================

/** Leitura pública (página): progresso + números ocupados. Fica em cache. */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'status';
  try {
    if (action === 'status' || action === 'getProgress' || action === 'read') {
      return json_(statusPublico_());
    }
    return json_({ ok: false, erro: 'Ação desconhecida.' });
  } catch (err) {
    return json_({ ok: false, erro: 'Erro no servidor: ' + err.message });
  }
}

/**
 * Ações com dados pessoais chegam por POST (corpo JSON enviado como text/plain,
 * para não haver preflight de CORS). Nada de dado pessoal na URL.
 */
function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, erro: 'Pedido inválido.' });
  }
  try {
    switch (body.action) {
      case 'consult': return json_(consultar_(body));
      case 'login': return json_(comVendedor_(body, v => ({ ok: true, vendedor: { nome: v.nome, perfil: v.perfil } })));
      case 'register': return json_(comVendedor_(body, v => registrar_(v, body)));
      case 'list': return json_(comVendedor_(body, v => listar_(v)));
      case 'setStatus': return json_(comVendedor_(body, v => mudarStatus_(v, body)));
      // equipe (só admin)
      case 'listUsers': return json_(comAdmin_(body, () => ({ ok: true, usuarios: listarUsuarios_() })));
      case 'addUser': return json_(comAdmin_(body, () => criarUsuario_(body)));
      case 'setUser': return json_(comAdmin_(body, v => alterarUsuario_(v, body)));
      case 'resetPin': return json_(comAdmin_(body, () => novoPin_(body)));
      default: return json_({ ok: false, erro: 'Ação desconhecida.' });
    }
  } catch (err) {
    return json_({ ok: false, erro: err.userMessage || ('Erro no servidor: ' + err.message) });
  }
}

// ===========================================================================
// Público
// ===========================================================================

function statusPublico_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_STATUS);
  if (hit) return JSON.parse(hit);

  const ocupados = lerVendas_().filter(v => v.status === STATUS.ATIVO).map(v => v.numero)
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .sort((a, b) => a - b);
  const res = {
    ok: true,
    total: CONFIG.TOTAL_NUMEROS,
    ocupados: ocupados.length,
    ocupadosLista: ocupados,
    atualizado: new Date().toISOString(),
  };
  cache.put(CACHE_STATUS, JSON.stringify(res), 60);
  return res;
}

/** Consulta do participante: (e-mail OU telefone) + data de nascimento. */
function consultar_(body) {
  const contato = String(body.contato || '').trim().toLowerCase();
  const nasc = String(body.nascimento || '').trim();
  if (!contato || !/^\d{4}-\d{2}-\d{2}$/.test(nasc)) {
    return { ok: false, erro: 'Informe o e-mail ou telefone e a data de nascimento.' };
  }
  const porEmail = contato.indexOf('@') >= 0;
  const digitos = contato.replace(/\D/g, '');
  if (!porEmail && digitos.length < 10) {
    return { ok: false, erro: 'Telefone incompleto. Use DDD + número.' };
  }
  const numeros = lerVendas_()
    .filter(v => v.status === STATUS.ATIVO && v.nascimento === nasc)
    .filter(v => porEmail ? v.email === contato : mesmoTelefone_(v.telefone, digitos))
    .map(v => v.numero)
    .sort((a, b) => a - b);
  return { ok: true, numeros: numeros };
}

// ===========================================================================
// Sistema dos vendedores
// ===========================================================================

function comVendedor_(body, fn) {
  const cache = CacheService.getScriptCache();
  const falhas = Number(cache.get(CACHE_FALHAS) || 0);
  if (falhas >= MAX_FALHAS_PIN) {
    return { ok: false, erro: 'Muitas tentativas de PIN erradas. Aguarde 10 minutos.', auth: true };
  }
  const pin = String(body.pin || '').trim();
  const vendedor = pin ? lerVendedores_().find(v => v.pin === pin && v.ativo) : null;
  if (!vendedor) {
    cache.put(CACHE_FALHAS, String(falhas + 1), 600);
    return { ok: false, erro: 'PIN inválido ou vendedor inativo.', auth: true };
  }
  return fn(vendedor);
}

function comAdmin_(body, fn) {
  return comVendedor_(body, v => v.perfil === 'admin' ? fn(v) : erro_('Só o administrador pode fazer isso.'));
}

function registrar_(vendedor, body) {
  const nome = limpar_(body.nome, 120);
  const telefone = String(body.telefone || '').replace(/\D/g, '');
  const email = limpar_(body.email, 120).toLowerCase();
  const nasc = String(body.nascimento || '').trim();
  const quantidade = Number(body.quantidade);
  const numeros = Array.isArray(body.numeros) ? body.numeros.map(Number) : [];
  const max = CONFIG.MAX_NUMEROS_POR_CADASTRO;

  if (!nome) return erro_('Informe o nome do participante.');
  if (telefone.length < 10 || telefone.length > 11) return erro_('Telefone inválido. Use DDD + número.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erro_('E-mail inválido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nasc)) return erro_('Informe a data de nascimento.');
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > max) {
    return erro_('Informe a quantidade de números (de 1 a ' + max + ').');
  }
  const invalidos = numeros.filter(n => !Number.isInteger(n) || n < 1 || n > CONFIG.TOTAL_NUMEROS);
  if (invalidos.length) return erro_('Números fora de 1 a ' + CONFIG.TOTAL_NUMEROS + ': ' + invalidos.join(', '));
  const unicos = numeros.filter((n, i) => numeros.indexOf(n) === i);
  if (unicos.length !== quantidade) {
    return erro_('A pessoa tem direito a ' + quantidade + (quantidade > 1 ? ' números' : ' número') +
      ', mas ' + (unicos.length === 1 ? 'foi escolhido 1' : 'foram escolhidos ' + unicos.length) + '.');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return erro_('Sistema ocupado, tente de novo em alguns segundos.');
  try {
    const ocupados = {};
    lerVendas_().forEach(v => { if (v.status === STATUS.ATIVO) ocupados[v.numero] = true; });
    const conflito = unicos.filter(n => ocupados[n]);
    if (conflito.length) {
      return { ok: false, erro: 'Já escolhido(s) por outra pessoa: ' + conflito.join(', ') + '. Nada foi gravado.', ocupados: conflito };
    }
    const agora = new Date();
    // meio-dia em Brasília: a data não muda, seja qual for o fuso do projeto do Apps Script
    const nascData = Utilities.parseDate(nasc + ' 12:00', CONFIG.FUSO, 'yyyy-MM-dd HH:mm');
    const linhas = unicos.map(n => [agora, nome, telefone, email, nascData, vendedor.nome, n, STATUS.ATIVO, agora, vendedor.nome]);
    const sheet = abaVendas_();
    sheet.getRange(sheet.getLastRow() + 1, 1, linhas.length, N_COLS).setValues(linhas);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove(CACHE_STATUS);
  } finally {
    lock.releaseLock();
  }

  // O e-mail nunca derruba o cadastro: os números já estão gravados.
  let emailEnviado = false, avisoEmail = '';
  if (email && CONFIG.ENVIAR_EMAIL) {
    try {
      if (MailApp.getRemainingDailyQuota() < 1) throw new Error('cota diária de e-mails esgotada');
      enviarEmail_(email, nome, unicos, vendedor.nome);
      emailEnviado = true;
    } catch (err) {
      avisoEmail = 'Cadastro gravado, mas o e-mail não foi enviado (' + err.message + ').';
    }
  }
  return { ok: true, numeros: unicos, emailEnviado: emailEnviado, aviso: avisoEmail, publico: statusPublico_() };
}

function listar_(vendedor) {
  const todas = lerVendas_();
  const admin = vendedor.perfil === 'admin';
  const visiveis = admin ? todas : todas.filter(v => v.vendedor === vendedor.nome);

  // Ranking: números e pessoas (telefones diferentes) cadastrados por vendedor
  const ranking = {};
  const novo = nome => ({ nome: nome, numeros: 0, pessoas: 0, tel: {} });
  lerVendedores_().filter(v => v.ativo && v.perfil !== 'admin').forEach(v => { ranking[v.nome] = novo(v.nome); });
  todas.forEach(v => {
    if (v.status !== STATUS.ATIVO || !v.vendedor) return;
    const r = ranking[v.vendedor] || (ranking[v.vendedor] = novo(v.vendedor));
    r.numeros++;
    const chave = v.telefone || v.nome;
    if (!r.tel[chave]) { r.tel[chave] = true; r.pessoas++; }
  });

  return {
    ok: true,
    vendedor: { nome: vendedor.nome, perfil: vendedor.perfil },
    total: CONFIG.TOTAL_NUMEROS,
    maxPorCadastro: CONFIG.MAX_NUMEROS_POR_CADASTRO,
    vendas: visiveis.map(v => ({
      linha: v.linha, data: v.data, nome: v.nome, telefone: v.telefone, email: v.email,
      numero: v.numero, status: v.status, vendedor: v.vendedor, atualizadoEm: v.atualizadoEm,
    })).reverse(),
    ranking: Object.keys(ranking).map(k => ({ nome: ranking[k].nome, numeros: ranking[k].numeros, pessoas: ranking[k].pessoas }))
      .sort((a, b) => (b.numeros - a.numeros) || (b.pessoas - a.pessoas) || a.nome.localeCompare(b.nome)),
    publico: statusPublico_(),
    usuarios: admin ? listarUsuarios_(todas) : undefined, // admin recebe a equipe na mesma sincronização
  };
}

/** Cancela um número (libera) ou reativa um cancelado (só admin). */
function mudarStatus_(vendedor, body) {
  const linha = Number(body.linha);
  const numero = Number(body.numero);
  const novo = String(body.status || '');
  if (!STATUS[novo]) return erro_('Status inválido.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return erro_('Sistema ocupado, tente de novo em alguns segundos.');
  try {
    const venda = lerVendas_().find(v => v.linha === linha);
    // confere o número para não alterar a linha errada se a planilha mudou
    if (!venda || venda.numero !== numero) return erro_('Cadastro não encontrado. Atualize a lista.');
    const admin = vendedor.perfil === 'admin';
    if (!admin && venda.vendedor !== vendedor.nome) return erro_('Você só pode alterar os seus cadastros.');
    if (venda.status === novo) return listar_(vendedor); // já está assim (ex.: clique duplo)
    if (novo === STATUS.ATIVO) {
      if (!admin) return erro_('Número cancelado: só o administrador pode reativar.');
      const outro = lerVendas_().find(v => v.numero === numero && v.status === STATUS.ATIVO);
      if (outro) return erro_('O número ' + numero + ' já foi escolhido por outra pessoa. Não dá para reativar.');
    }
    const sheet = abaVendas_();
    sheet.getRange(linha, COL.STATUS).setValue(novo);
    sheet.getRange(linha, COL.ATUALIZADO_EM, 1, 2).setValues([[new Date(), vendedor.nome]]);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove(CACHE_STATUS);
  } finally {
    lock.releaseLock();
  }
  return listar_(vendedor);
}

// ===========================================================================
// Equipe (só admin): cadastrar, ativar/desativar e gerar PIN novo
// ===========================================================================

const chaveNome_ = s => String(s || '').trim().toLowerCase();

/** Lista sem os PINs: o PIN só aparece na hora em que é criado. */
function listarUsuarios_(vendas) {
  const numeros = {};
  (vendas || lerVendas_()).forEach(v => { if (v.status === STATUS.ATIVO) numeros[v.vendedor] = (numeros[v.vendedor] || 0) + 1; });
  return lerVendedores_()
    .map(v => ({ nome: v.nome, perfil: v.perfil, ativo: v.ativo, numeros: numeros[v.nome] || 0 }))
    .sort((a, b) => (b.ativo - a.ativo) || a.nome.localeCompare(b.nome));
}

function gerarPin_() {
  const usados = {};
  lerVendedores_().forEach(v => { usados[v.pin] = true; });
  for (let i = 0; i < 50; i++) {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    if (!usados[pin]) return pin;
  }
  throw usuario_('Não foi possível gerar um PIN. Tente de novo.');
}

function usuarioPorNome_(nome) {
  const u = lerVendedores_().find(v => chaveNome_(v.nome) === chaveNome_(nome));
  if (!u) throw usuario_('Pessoa não encontrada. Atualize a lista.');
  return u;
}

function criarUsuario_(body) {
  const nome = limpar_(body.nome, 60);
  const perfil = body.perfil === 'admin' ? 'admin' : 'vendedor';
  if (nome.length < 2) return erro_('Informe o nome da pessoa.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return erro_('Sistema ocupado, tente de novo em alguns segundos.');
  try {
    const sh = abaVendedores_();
    const nomes = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => chaveNome_(r[0]));
    if (nomes.indexOf(chaveNome_(nome)) >= 0) {
      return erro_('Já existe alguém com o nome "' + nome + '". Use um nome diferente (ex.: com o sobrenome).');
    }
    const pin = gerarPin_();
    const linha = sh.getLastRow() + 1;
    sh.getRange(linha, 2).setNumberFormat('@'); // PIN como texto
    sh.getRange(linha, 1, 1, 4).setValues([[nome, pin, perfil, 'SIM']]);
    SpreadsheetApp.flush();
    return { ok: true, nome: nome, pin: pin, usuarios: listarUsuarios_() };
  } finally {
    lock.releaseLock();
  }
}

/** Ativa/desativa ou troca o perfil. Sempre sobra pelo menos um admin ativo. */
function alterarUsuario_(eu, body) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return erro_('Sistema ocupado, tente de novo em alguns segundos.');
  try {
    const u = usuarioPorNome_(body.nome);
    const ativo = typeof body.ativo === 'boolean' ? body.ativo : u.ativo;
    const perfil = body.perfil === 'admin' || body.perfil === 'vendedor' ? body.perfil : u.perfil;
    const souEu = chaveNome_(u.nome) === chaveNome_(eu.nome);
    if (souEu && (!ativo || perfil !== 'admin')) return erro_('Você não pode desativar nem tirar o admin de si mesmo.');
    const outrosAdmins = lerVendedores_().filter(v => v.ativo && v.perfil === 'admin' && v.linha !== u.linha).length;
    if (u.perfil === 'admin' && u.ativo && (!ativo || perfil !== 'admin') && outrosAdmins === 0) {
      return erro_('Precisa sobrar pelo menos um administrador ativo.');
    }
    abaVendedores_().getRange(u.linha, 3, 1, 2).setValues([[perfil, ativo ? 'SIM' : 'NÃO']]);
    SpreadsheetApp.flush();
    return { ok: true, usuarios: listarUsuarios_() };
  } finally {
    lock.releaseLock();
  }
}

/** Gera um PIN novo (o antigo para de funcionar na hora). */
function novoPin_(body) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return erro_('Sistema ocupado, tente de novo em alguns segundos.');
  try {
    const u = usuarioPorNome_(body.nome);
    const pin = gerarPin_();
    const cel = abaVendedores_().getRange(u.linha, 2);
    cel.setNumberFormat('@');
    cel.setValue(pin);
    SpreadsheetApp.flush();
    return { ok: true, nome: u.nome, pin: pin, usuarios: listarUsuarios_() };
  } finally {
    lock.releaseLock();
  }
}

// ===========================================================================
// Planilha
// ===========================================================================

function planilha_() { return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); }

function abaVendas_() {
  const sh = planilha_().getSheetByName(CONFIG.ABA_VENDAS);
  if (!sh) throw usuario_('Aba "' + CONFIG.ABA_VENDAS + '" não existe. Rode a função setup no Apps Script.');
  return sh;
}

function lerVendas_() {
  const sh = abaVendas_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, N_COLS).getValues()
    .map((r, i) => ({
      linha: i + 2,
      data: iso_(r[COL.DATA - 1]),
      nome: String(r[COL.NOME - 1] || '').trim(),
      telefone: String(r[COL.TELEFONE - 1] || '').replace(/\D/g, ''),
      email: String(r[COL.EMAIL - 1] || '').trim().toLowerCase(),
      nascimento: dataChave_(r[COL.NASCIMENTO - 1]),
      vendedor: String(r[COL.VENDEDOR - 1] || '').trim(),
      numero: Number(r[COL.NUMERO - 1]),
      status: String(r[COL.STATUS - 1] || '').trim().toUpperCase() === STATUS.CANCELADO ? STATUS.CANCELADO : STATUS.ATIVO,
      atualizadoEm: iso_(r[COL.ATUALIZADO_EM - 1]),
    }))
    .filter(v => Number.isInteger(v.numero) && v.numero > 0);
}

function abaVendedores_() {
  const sh = planilha_().getSheetByName(CONFIG.ABA_VENDEDORES);
  if (!sh) throw usuario_('Aba "' + CONFIG.ABA_VENDEDORES + '" não existe. Rode a função setup no Apps Script.');
  return sh;
}

function lerVendedores_() {
  const sh = planilha_().getSheetByName(CONFIG.ABA_VENDEDORES);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .map((r, i) => ({
      linha: i + 2,
      nome: String(r[0] || '').trim(),
      pin: String(r[1] || '').trim(),
      perfil: String(r[2] || '').trim().toLowerCase() === 'admin' ? 'admin' : 'vendedor',
      ativo: String(r[3] || 'SIM').trim().toUpperCase() !== 'NÃO' && String(r[3] || '').trim().toUpperCase() !== 'NAO',
    }))
    .filter(v => v.nome && v.pin.length >= 4);
}

/** Rode uma vez pelo editor: cria as abas e o administrador. */
function setup() {
  const ss = planilha_();
  // datas e horas da planilha em horário de Brasília (UTC-3)
  if (ss.getSpreadsheetTimeZone() !== CONFIG.FUSO) {
    ss.setSpreadsheetTimeZone(CONFIG.FUSO);
    Logger.log('Fuso da planilha ajustado para ' + CONFIG.FUSO + ' (UTC-3).');
  }
  let vendas = ss.getSheetByName(CONFIG.ABA_VENDAS);
  if (!vendas) {
    vendas = ss.insertSheet(CONFIG.ABA_VENDAS);
    vendas.getRange(1, 1, 1, N_COLS).setValues([CABECALHO]).setFontWeight('bold');
    vendas.setFrozenRows(1);
  }
  vendas.getRange('C2:C').setNumberFormat('@');          // telefone como texto
  vendas.getRange('E2:E').setNumberFormat('dd/MM/yyyy');  // nascimento
  vendas.getRange('A2:A').setNumberFormat('dd/MM/yyyy HH:mm');
  vendas.getRange('I2:I').setNumberFormat('dd/MM/yyyy HH:mm');

  let vend = ss.getSheetByName(CONFIG.ABA_VENDEDORES);
  if (!vend) {
    vend = ss.insertSheet(CONFIG.ABA_VENDEDORES);
    vend.getRange(1, 1, 1, 4).setValues([['Nome', 'PIN', 'Perfil (admin/vendedor)', 'Ativo (SIM/NÃO)']]).setFontWeight('bold');
    vend.setFrozenRows(1);
    vend.getRange('B2:B').setNumberFormat('@');
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    vend.appendRow(['Administrador', pin, 'admin', 'SIM']);
    Logger.log('Aba Vendedores criada. PIN do Administrador: ' + pin + ' (troque o nome e cadastre os vendedores na planilha).');
  } else {
    Logger.log('Aba Vendedores já existia. Nada foi alterado nela.');
  }
  CacheService.getScriptCache().remove(CACHE_STATUS);
  Logger.log('Pronto. Aba de cadastros: ' + CONFIG.ABA_VENDAS);
}

// ===========================================================================
// E-mail
// ===========================================================================

function enviarEmail_(email, nome, numeros, vendedor) {
  const msg = montarEmail_({ nome: nome, numeros: numeros, vendedor: vendedor, quando: new Date() });
  MailApp.sendEmail({ to: email, subject: msg.assunto, body: msg.texto, htmlBody: msg.html, name: CONFIG.TITULO });
}

/**
 * Monta o e-mail de confirmação (assunto, HTML e texto puro).
 * Layout em tabelas com estilos inline: é o que funciona no Gmail, Outlook e celular.
 * Para ver como fica sem enviar, rode `testarEmail` no editor (manda para o seu e-mail).
 */
function montarEmail_(d) {
  const nums = d.numeros.slice().sort((a, b) => a - b);
  const n = nums.length;
  const varios = n > 1;
  const primeiro = String(d.nome).trim().split(/\s+/)[0];
  const quando = Utilities.formatDate(d.quando, CONFIG.FUSO, "dd/MM/yyyy 'às' HH:mm");
  const zap = 'https://wa.me/' + CONFIG.WHATSAPP_CONTATO;
  const assunto = n <= 5
    ? (varios ? 'Seus números no sorteio ' : 'Seu número no sorteio ') + CONFIG.TITULO + ': ' + nums.join(', ')
    : 'Seus ' + n + ' números no sorteio ' + CONFIG.TITULO + ' estão confirmados';

  const OURO = '#f5b301', PRETO = '#0b0b0b', TEXTO = '#1f1f1f', SUAVE = '#6b6b6b', LINHA = '#ececec';
  const fonte = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  const chips = nums.map(x =>
    '<span style="display:inline-block;min-width:44px;margin:0 6px 8px 0;padding:10px 12px;border-radius:8px;' +
    'background:' + PRETO + ';color:' + OURO + ';font-size:20px;font-weight:800;text-align:center;letter-spacing:.5px">' +
    x + '</span>').join('');
  const linha = (rot, val) =>
    '<tr><td style="padding:10px 0;border-top:1px solid ' + LINHA + ';color:' + SUAVE + ';font-size:13px;width:38%;vertical-align:top">' + rot + '</td>' +
    '<td style="padding:10px 0;border-top:1px solid ' + LINHA + ';color:' + TEXTO + ';font-size:14px;font-weight:600;vertical-align:top">' + val + '</td></tr>';

  const html =
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><title>' + esc_(assunto) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f2f2f2;' + fonte + '">' +
    // texto de pré-visualização na caixa de entrada (fica escondido no corpo)
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' +
    (varios ? 'Seus números estão confirmados' : 'Seu número está confirmado') + '. Sorteio em ' + esc_(CONFIG.DATA_SORTEIO_TEXTO) + '.</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">' +

    // topo
    '<tr><td style="background:' + PRETO + ';padding:28px 32px 24px">' +
    '<div style="display:inline-block;background:' + OURO + ';color:' + PRETO + ';font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;padding:5px 10px;border-radius:4px">' +
    esc_(CONFIG.SELO) + '</div>' +
    '<div style="color:#ffffff;font-size:26px;font-weight:800;line-height:1.2;margin-top:14px">' + esc_(CONFIG.TITULO) + '</div>' +
    '<div style="color:#bdbdbd;font-size:13px;margin-top:4px">' + esc_(CONFIG.ORGANIZACAO) + '</div>' +
    '</td></tr>' +
    '<tr><td style="height:4px;background:' + OURO + ';line-height:4px;font-size:0">&nbsp;</td></tr>' +

    // corpo
    '<tr><td style="padding:30px 32px 8px;color:' + TEXTO + '">' +
    '<p style="margin:0 0 12px;font-size:17px;font-weight:700">Olá, ' + esc_(primeiro) + '!</p>' +
    '<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#3a3a3a">Sua participação está <strong>confirmada</strong>. ' +
    'Obrigado por participar! Agora é só aguardar o sorteio e torcer.</p>' +
    '<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:' + SUAVE + '">' +
    (varios ? 'Seus ' + n + ' números' : 'Seu número') + '</p>' +
    '<div style="margin:0 0 18px">' + chips + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px">' +
    linha('Prêmio', esc_(CONFIG.PREMIO)) +
    linha('Sorteio', esc_(CONFIG.DATA_SORTEIO_TEXTO)) +
    linha('Cadastro', esc_(quando)) +
    (d.vendedor ? linha('Vendedor', esc_(d.vendedor)) : '') +
    '</table>' +
    '</td></tr>' +

    // botão
    '<tr><td align="center" style="padding:18px 32px 8px">' +
    '<a href="' + CONFIG.LINK_SITE + '" style="display:inline-block;background:' + PRETO + ';color:' + OURO + ';text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:999px">' +
    'Acompanhar o sorteio</a>' +
    '<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:' + SUAVE + '">Para consultar seus números no site, use este e-mail e a sua data de nascimento.</p>' +
    '</td></tr>' +

    // rodapé
    '<tr><td style="padding:26px 32px 30px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ' + LINHA + ';padding-top:18px;font-size:12px;line-height:1.6;color:' + SUAVE + '">' +
    'Guarde este e-mail como comprovante da sua participação.<br>' +
    'Dúvidas? Fale com a gente pelo <a href="' + zap + '" style="color:' + TEXTO + ';font-weight:600">WhatsApp</a>.<br><br>' +
    '<strong style="color:' + TEXTO + '">' + esc_(CONFIG.ORGANIZACAO) + '</strong>' +
    '</td></tr></table>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';

  const texto = [
    'Olá, ' + primeiro + '!', '',
    'Sua participação no sorteio ' + CONFIG.TITULO + ' está confirmada. Obrigado por participar!', '',
    (varios ? 'Seus números: ' : 'Seu número: ') + nums.join(', '),
    'Prêmio: ' + CONFIG.PREMIO,
    'Sorteio: ' + CONFIG.DATA_SORTEIO_TEXTO,
    'Cadastro: ' + quando + (d.vendedor ? ' (vendedor: ' + d.vendedor + ')' : ''), '',
    'Acompanhe o sorteio: ' + CONFIG.LINK_SITE,
    'Para consultar seus números no site, use este e-mail e a sua data de nascimento.', '',
    'Dúvidas? WhatsApp: ' + zap, '',
    CONFIG.ORGANIZACAO,
  ].join('\n');

  return { assunto: assunto, html: html, texto: texto };
}

/** Rode pelo editor para receber um e-mail de exemplo na sua própria caixa. */
function testarEmail() {
  const eu = Session.getActiveUser().getEmail();
  enviarEmail_(eu, 'Maria Aparecida da Silva', [7, 42, 315], 'Joana');
  Logger.log('E-mail de teste enviado para ' + eu);
}

// ===========================================================================
// Utilidades
// ===========================================================================

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function usuario_(msg) { const e = new Error(msg); e.userMessage = msg; return e; }
function erro_(msg) { return { ok: false, erro: msg }; }
function limpar_(v, max) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function esc_(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function iso_(v) { return v instanceof Date && !isNaN(v) ? v.toISOString() : ''; }
function dataChave_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, CONFIG.FUSO, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
}
function mesmoTelefone_(salvo, digitado) {
  if (!salvo || !digitado) return false;
  // aceita com ou sem 55, com ou sem o 9: compara os últimos 8 dígitos + DDD
  const a = salvo.replace(/^55(?=\d{10,11}$)/, ''), b = digitado.replace(/^55(?=\d{10,11}$)/, '');
  return a.slice(0, 2) === b.slice(0, 2) && a.slice(-8) === b.slice(-8);
}
