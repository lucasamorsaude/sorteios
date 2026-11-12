/**
 * CONFIGURAÇÃO DA CAMPANHA: o único arquivo do site que muda de um ano para o outro.
 * (No Apps Script, mude também o bloco CONFIG no topo do codigo.gs.)
 */
window.CONFIG = {
  // URL da implantação do Apps Script (continua a mesma se publicar como "Nova versão")
  apiUrl: 'https://script.google.com/macros/s/AKfycbzKyAaF13MoAT49-rz5yFXXjovEWFLnXWTibXDWfzvvGmTseehnLhjgIK2kOCdB0GR8/exec',

  ano: 2026,
  organizacao: 'AS e CDT · São João del-Rei',
  titulo: 'Black November CDT e AS',
  tituloDestaque: 'Black November', // trecho do título em dourado (vazio = última palavra)
  selo: ['Sorteio', '2026'],         // etiqueta acima do título: parte cheia + parte contornada
  chamada: 'Concorra a um kit completo de eletrodomésticos.',

  // Data e hora do sorteio (horário de Brasília). A DEFINIR: confirme antes de publicar.
  dataSorteio: '2026-12-04T15:00:00-03:00',

  totalNumeros: 1000, // o servidor também informa; este valor só é usado até a resposta chegar
  // Não há preço por número: o vendedor informa quantos números cada pessoa pode escolher.

  whatsapp: '553239380908', // só dígitos, com 55 + DDD

  // Endereço do sistema dos vendedores (vai na mensagem com o PIN de quem é cadastrado)
  urlSistema: 'https://lucasamorsaude.github.io/sorteios/admin_panel.html',

  premio: {
    titulo: 'O prêmio',
    subtitulo: 'Um único ganhador leva o kit completo.',
    itens: [
      { nome: 'Batedeira', detalhe: 'Bolos, massas e receitas caprichadas', icone: 'batedeira' },
      { nome: 'Liquidificador', detalhe: 'Sucos, vitaminas e receitas do dia a dia', icone: 'liquidificador' },
      { nome: 'Churrasqueira', detalhe: 'Para reunir a família e os amigos', icone: 'churrasqueira' },
      { nome: 'Misteira', detalhe: 'Para aquele misto quente caprichado', icone: 'misteira' }
    ],
  },

  // Marcos da barra de progresso (em %)
  metas: [25, 50, 75],

  // Depois do sorteio, preencha para mostrar o resultado na página
  resultado: { numero: null, ganhador: '' },
};
