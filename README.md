# Rifa Natal Solidário

Site da rifa: contagem regressiva, progresso, prêmio e consulta do comprador. A escolha dos
números é feita só pelos vendedores, no sistema. Inclui o
**Sistema da Rifa** (`admin_panel.html`), onde cada vendedor entra com seu PIN.

- **Site:** GitHub Pages (`index.html`)
- **Servidor:** Google Apps Script (`codigo.gs`) + planilha Google

## Como funciona a rifa

Não há preço por número. Conforme o motivo, cada pessoa tem direito a uma quantidade de números.
No sistema, o vendedor informa **quantos números** a pessoa vai escolher e marca exatamente essa
quantidade na grade, junto com ela. O sistema não deixa salvar com números a mais ou a menos.
O número vale assim que é cadastrado (não existe reservado ou pago).

## Arquivos

| Arquivo | Para quê |
|---|---|
| `config.js` | **Configuração da campanha** (data, textos, prêmio, WhatsApp, URL do Apps Script) |
| `index.html`, `site.css`, `site.js` | Página pública |
| `admin_panel.html`, `admin.css`, `admin.js` | Sistema dos vendedores |
| `api.js` | Comunicação com o Apps Script (compartilhado) |
| `codigo.gs` | Cópia do código do Apps Script (é colado à mão no editor do Google) |
| `assets/` | Fundo (`fundo.webp` e `fundo-mobile.webp`), ícones e `og.jpg` (prévia no WhatsApp) |

## Planilha

- **Aba `Rifa 2026`**: uma linha por número.
  Colunas: Data · Nome · Telefone · E-mail · Nascimento · Vendedor · Número · Status · Atualizado em · Atualizado por.
  Status: `ATIVO` ou `CANCELADO` (o cancelado libera o número).
- **Aba `Vendedores`**: Nome · PIN · Perfil (`admin` ou `vendedor`) · Ativo (`SIM`/`NÃO`).
  - **A equipe é gerenciada pelo próprio sistema**, na aba **Equipe** (só aparece para admin):
    cadastrar pessoa (o sistema gera um PIN de 6 dígitos, mostrado uma única vez, com botões para
    copiar ou mandar pelo WhatsApp), gerar PIN novo, desativar/reativar e tornar admin/vendedor.
    Sempre sobra pelo menos um admin ativo, e ninguém desativa a si mesmo.
  - O vendedor vê os próprios cadastros e pode cancelar um número (ele volta a ficar livre).
    O admin vê tudo, filtra por vendedor, exporta CSV e reativa números cancelados.
  - Não renomeie na planilha um vendedor que já tem cadastros, porque eles ficam ligados ao nome.
  - O link mandado junto com o PIN é o `urlSistema` do `config.js`.

## Publicar o servidor (Apps Script)

1. Abra o projeto do Apps Script e substitua todo o código pelo conteúdo de `codigo.gs`.
2. Selecione a função **`setup`** e clique em **Executar**. Ela cria as abas `Rifa 2026` e `Vendedores`,
   se ainda não existirem, e mostra o **PIN do Administrador** em *Registro de execução*.
3. Entre no sistema com o PIN do Administrador e cadastre a equipe na aba **Equipe**.
4. **Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar.**
   Assim a URL continua a mesma e o `config.js` não precisa mudar.

## Virada de ano (checklist)

1. `config.js`: `ano`, `dataSorteio`, `totalNumeros`, textos e itens do prêmio.
2. `codigo.gs` (bloco `CONFIG`): `ABA_VENDAS` (ex.: `Rifa 2027`), `TOTAL_NUMEROS`,
   `MAX_NUMEROS_POR_CADASTRO`, `PREMIO`, `DATA_SORTEIO_TEXTO`. Cole no Apps Script, rode `setup` e publique como nova versão.
3. Troque a arte em `assets/` (fundo 1920×1080 em WebP, até ~250 KB; versão de celular 720×1280;
   `og.jpg` 1200×630). Para usar fotos do prêmio, coloque os arquivos em `assets/premio/` e preencha
   `imagem` em cada item do `config.js`.
4. A aba do ano anterior fica guardada na planilha.

## Depois do sorteio

Em `config.js`, preencha `resultado: { numero: 123, ganhador: 'Maria S.' }` e publique.
A página troca a contagem pelo resultado.
