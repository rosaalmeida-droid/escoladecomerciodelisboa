/**
 * Store.js — guarda tudo numa Google Sheet (a "base de dados" da aplicação).
 *
 * Folhas:
 *   Eventos   — uma linha por evento: colunas legíveis + o registo completo em JSON (colunas J em diante)
 *   Tarefas   — vista de todas as tarefas, regenerada a cada gravação (só para consulta/filtros)
 *   Registo   — cada email lido: a que evento foi associado ou porque foi ignorado
 *   Conversas — ligação entre conversas do Gmail (threads) e eventos
 */
var Store = (function () {
  var CAB_EVENTOS = ['ID', 'Nome', 'Estado', 'Data', 'Local', 'Responsável geral', 'Pendentes', 'Concluídas', 'Atualizado', 'JSON'];
  var COL_JSON = 9; // índice (0-based) da primeira coluna de JSON
  var PEDACO = 45000; // as células da Sheet aceitam até 50 000 caracteres
  var CAB_TAREFAS = ['Evento', '#', 'Tarefa', 'Responsável', 'Email', 'Área', 'Prazo', 'Estado'];
  var CAB_REGISTO = ['ID mensagem', 'Conversa', 'Data', 'De', 'Assunto', 'Evento', 'Resultado'];
  var CAB_CONVERSAS = ['Conversa', 'Evento', 'Atualizado'];

  var _ss = null;

  function ss() {
    if (_ss) return _ss;
    var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!id) throw new Error('A aplicação ainda não foi instalada: execute a função instalar().');
    _ss = SpreadsheetApp.openById(id);
    return _ss;
  }

  function folha(nome, cabecalho) {
    var s = ss();
    var sh = s.getSheetByName(nome);
    if (!sh) {
      sh = s.insertSheet(nome);
      sh.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    return sh;
  }

  function linhas(sh) {
    var n = sh.getLastRow();
    if (n < 2) return [];
    return sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues();
  }

  // ---------------------------------------------------------------- eventos

  function carregarEventos() {
    return linhas(folha('Eventos', CAB_EVENTOS)).map(function (r) {
      var json = r.slice(COL_JSON).join('');
      try { return json ? JSON.parse(json) : null; } catch (e) { return null; }
    }).filter(Boolean);
  }

  function guardarEventos(eventos) {
    var sh = folha('Eventos', CAB_EVENTOS);
    eventos.sort(function (a, b) { return (a.data || '9999') < (b.data || '9999') ? -1 : 1; });
    var linhasNovas = eventos.map(function (ev) {
      var json = JSON.stringify(ev);
      var pedacos = [];
      for (var i = 0; i < json.length; i += PEDACO) pedacos.push(json.slice(i, i + PEDACO));
      return [
        ev.id, ev.nome, ev.estado, ev.data ? Nucleo.dataCurta(ev.data) + (ev.hora ? ' ' + ev.hora : '') : '',
        ev.local, ev.coordenador ? ev.coordenador.nome : '',
        ev.tarefas.filter(function (t) { return t.estado === 'pendente'; }).length,
        ev.tarefas.filter(function (t) { return t.estado === 'concluida'; }).length,
        ev.atualizadoEm ? new Date(ev.atualizadoEm) : ''
      ].concat(pedacos);
    });
    var largura = linhasNovas.reduce(function (m, r) { return Math.max(m, r.length); }, CAB_EVENTOS.length);
    linhasNovas.forEach(function (r) { while (r.length < largura) r.push(''); });

    var antigas = sh.getLastRow() - 1;
    if (antigas > 0) sh.getRange(2, 1, antigas, sh.getLastColumn()).clearContent();
    if (linhasNovas.length) sh.getRange(2, 1, linhasNovas.length, largura).setValues(linhasNovas);
    escreverTarefas(eventos);
  }

  function escreverTarefas(eventos) {
    var sh = folha('Tarefas', CAB_TAREFAS);
    var rows = [];
    eventos.forEach(function (ev) {
      ev.tarefas.forEach(function (t) {
        rows.push([ev.nome, t.id, t.descricao, t.responsavel ? t.responsavel.nome : '', t.responsavel ? t.responsavel.email : '',
          t.area || '', t.prazo ? Nucleo.dataCurta(t.prazo) : '', t.estado]);
      });
    });
    var antigas = sh.getLastRow() - 1;
    if (antigas > 0) sh.getRange(2, 1, antigas, CAB_TAREFAS.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, CAB_TAREFAS.length).setValues(rows);
  }

  // ---------------------------------------------------------------- registo de mensagens

  function idsRegistados() {
    var vistos = {};
    var sh = folha('Registo', CAB_REGISTO);
    var n = sh.getLastRow();
    if (n < 2) return vistos;
    sh.getRange(2, 1, n - 1, 1).getValues().forEach(function (r) { vistos[r[0]] = true; });
    return vistos;
  }

  /** mensagens: [{id, threadId, data, de, assunto}] */
  function registar(mensagens, evento, resultado) {
    if (!mensagens.length) return;
    var sh = folha('Registo', CAB_REGISTO);
    var rows = mensagens.map(function (m) {
      return [m.id, m.threadId, new Date(m.data), m.de ? m.de.nome + ' <' + m.de.email + '>' : '', m.assunto || '', evento || '', resultado || ''];
    });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, CAB_REGISTO.length).setValues(rows);
  }

  // ---------------------------------------------------------------- conversas

  function conversas() {
    var mapa = {};
    linhas(folha('Conversas', CAB_CONVERSAS)).forEach(function (r) { mapa[r[0]] = r[1]; });
    return mapa;
  }

  function ligarConversa(threadId, eventoId) {
    var sh = folha('Conversas', CAB_CONVERSAS);
    var dados = linhas(sh);
    for (var i = 0; i < dados.length; i++) {
      if (dados[i][0] === threadId) {
        sh.getRange(i + 2, 2, 1, 2).setValues([[eventoId, new Date()]]);
        return;
      }
    }
    sh.appendRow([threadId, eventoId, new Date()]);
  }

  // ---------------------------------------------------------------- instalação

  function criarFolhaDeCalculo() {
    var nova = SpreadsheetApp.create(CONFIG.NOME_APP + ' — dados');
    PropertiesService.getScriptProperties().setProperty('SHEET_ID', nova.getId());
    _ss = nova;
    folha('Eventos', CAB_EVENTOS);
    folha('Tarefas', CAB_TAREFAS);
    folha('Registo', CAB_REGISTO);
    folha('Conversas', CAB_CONVERSAS);
    var inicial = nova.getSheetByName('Sheet1') || nova.getSheetByName('Folha1') || nova.getSheetByName('Página1');
    if (inicial) nova.deleteSheet(inicial);
    return nova;
  }

  return {
    ss: ss,
    carregarEventos: carregarEventos,
    guardarEventos: guardarEventos,
    idsRegistados: idsRegistados,
    registar: registar,
    conversas: conversas,
    ligarConversa: ligarConversa,
    criarFolhaDeCalculo: criarFolhaDeCalculo
  };
})();
