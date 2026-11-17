/**
 * WebApp.js — a página que toda a escola abre para ver os eventos.
 * As funções api_* são chamadas a partir de Index.html com google.script.run.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.NOME_APP)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function utilizadorAtual() {
  return (Session.getActiveUser().getEmail() || '').toLowerCase();
}

function eAdmin(email) {
  var dono = Session.getEffectiveUser().getEmail().toLowerCase();
  return email === dono || CONFIG.ADMINS.map(function (e) { return e.toLowerCase(); }).indexOf(email) >= 0;
}

/** Versão do evento enviada ao navegador (sem os ids internos do Gmail). */
function paraNavegador(ev) {
  var c = JSON.parse(JSON.stringify(ev));
  delete c.mensagens;
  delete c.threads;
  return c;
}

function api_dados() {
  var eu = utilizadorAtual();
  return JSON.stringify({
    eu: eu,
    admin: eAdmin(eu),
    caixa: Session.getEffectiveUser().getEmail(),
    nomeApp: CONFIG.NOME_APP,
    ultimaSync: PropertiesService.getScriptProperties().getProperty('ULTIMA_SYNC'),
    eventos: Store.carregarEventos().map(paraNavegador)
  });
}

/**
 * Correções feitas na app (a IA pode enganar-se):
 * alteracoes = { estado?: 'pendente'|'concluida'|'cancelada', responsavel?: {nome, email}, prazo?: 'AAAA-MM-DD' }
 */
function api_tarefa(eventoId, tarefaId, alteracoes) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var eu = utilizadorAtual();
    var eventos = Store.carregarEventos();
    var ev = eventos.filter(function (e) { return e.id === eventoId; })[0];
    if (!ev) throw new Error('Evento não encontrado.');
    var t = ev.tarefas.filter(function (x) { return x.id === tarefaId; })[0];
    if (!t) throw new Error('Tarefa não encontrada.');
    var agora = new Date().toISOString();
    var feito = [];
    if (alteracoes.estado && ['pendente', 'concluida', 'cancelada'].indexOf(alteracoes.estado) >= 0 && alteracoes.estado !== t.estado) {
      t.estado = alteracoes.estado;
      t.concluidaEm = t.estado === 'concluida' ? agora : null;
      feito.push({ concluida: 'marcou como feita', pendente: 'reabriu', cancelada: 'cancelou' }[t.estado]);
    }
    if (alteracoes.responsavel) {
      var p = Nucleo.resolver(ev, alteracoes.responsavel);
      t.responsavel = p ? { nome: p.nome, email: p.email } : null;
      feito.push('passou para ' + (p ? p.nome : 'ninguém'));
    }
    if (alteracoes.prazo !== undefined) {
      t.prazo = /^\d{4}-\d{2}-\d{2}$/.test(alteracoes.prazo || '') ? alteracoes.prazo : null;
      feito.push('prazo ' + (t.prazo ? Nucleo.dataCurta(t.prazo) : 'removido'));
    }
    if (!feito.length) return JSON.stringify(paraNavegador(ev));
    var quem = ev.pessoas.filter(function (x) { return x.email === eu; })[0] || { nome: Nucleo.nomeDoEmail(eu), email: eu };
    ev.historico.push({
      id: 'app-' + Date.now(), data: agora, de: { nome: quem.nome, email: eu },
      resumo: 'Na app: ' + feito.join(', ') + ' a tarefa #' + t.id + ' (' + t.descricao + ').', excerto: '', app: true
    });
    ev.atualizadoEm = agora;
    Store.guardarEventos(eventos);
    return JSON.stringify(paraNavegador(ev));
  } finally {
    lock.releaseLock();
  }
}

/** "Quem trata do catering?" — a IA responde com base no registo do evento. */
function api_perguntar(eventoId, pergunta) {
  pergunta = String(pergunta || '').trim().slice(0, 1000);
  if (!pergunta) return '';
  var ev = Store.carregarEventos().filter(function (e) { return e.id === eventoId; })[0];
  if (!ev) throw new Error('Evento não encontrado.');
  return IA.chamar(Nucleo.SISTEMA_PERGUNTA, Nucleo.pedidoPergunta(ev, pergunta), null,
    { esforco: CONFIG.ESFORCO_PERGUNTA, maxTokens: 4000 });
}

function api_sincronizar() {
  if (!eAdmin(utilizadorAtual())) throw new Error('Só administradores podem forçar a leitura do email.');
  sincronizar();
  return api_dados();
}
