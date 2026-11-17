/**
 * Sincronizar.js — lê o Gmail, pede à IA para perceber as mensagens e atualiza os eventos.
 * Corre sozinho a cada 10 minutos (ver instalar()).
 */

function instalar() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_ID')) Store.criarFolhaDeCalculo();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(10).create();
  if (CONFIG.RESUMO_SEMANAL) {
    ScriptApp.newTrigger('enviarResumoSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  }
  Logger.log('Instalado. Dados em: ' + Store.ss().getUrl());
  if (!props.getProperty('ANTHROPIC_API_KEY')) {
    Logger.log('ATENÇÃO: falta a propriedade ANTHROPIC_API_KEY (Definições do projeto > Propriedades do script).');
  }
}

function sincronizar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  var inicio = Date.now();
  try {
    var eu = Session.getEffectiveUser().getEmail().toLowerCase();
    var ignorados = [eu].concat(CONFIG.ENDERECOS_IGNORADOS.map(function (e) { return e.toLowerCase(); }));
    var vistos = Store.idsRegistados();
    var ligacoes = Store.conversas();
    var eventos = Store.carregarEventos();
    var hoje = Utilities.formatDate(new Date(), 'Europe/Lisbon', 'yyyy-MM-dd');

    // 1. Recolher mensagens novas, agrupadas por conversa.
    var grupos = [];
    var rejeitadas = {};
    GmailApp.search(CONFIG.PESQUISA, 0, CONFIG.MAX_CONVERSAS).forEach(function (thread) {
      var novas = [];
      thread.getMessages().forEach(function (m) {
        var id = m.getId();
        if (vistos[id] || m.isInTrash()) return;
        var de = Nucleo.enderecos(m.getFrom())[0];
        var msg = {
          id: id,
          threadId: thread.getId(),
          data: m.getDate().toISOString(),
          de: de || null,
          envolvidos: Nucleo.enderecos([m.getTo(), m.getCc()].join(',')).filter(function (p) {
            return ignorados.indexOf(p.email) < 0;
          }),
          assunto: m.getSubject(),
          corpo: m.getPlainBody()
        };
        if (!de || ignorados.indexOf(de.email) >= 0) {
          (rejeitadas['enviada pela caixa de eventos'] = rejeitadas['enviada pela caixa de eventos'] || []).push(msg);
        } else if (CONFIG.DOMINIOS_PERMITIDOS.length && CONFIG.DOMINIOS_PERMITIDOS.indexOf(Nucleo.dominio(de.email)) < 0) {
          (rejeitadas['remetente fora da escola'] = rejeitadas['remetente fora da escola'] || []).push(msg);
        } else {
          novas.push(msg);
        }
      });
      if (novas.length) grupos.push({ threadId: thread.getId(), mensagens: novas });
    });
    Object.keys(rejeitadas).forEach(function (motivo) { Store.registar(rejeitadas[motivo], '', 'ignorada: ' + motivo); });
    grupos.sort(function (a, b) { return a.mensagens[0].data < b.mensagens[0].data ? -1 : 1; });

    // 2. Tratar cada conversa.
    for (var g = 0; g < grupos.length; g++) {
      if (Date.now() - inicio > CONFIG.LIMITE_MS) break; // o resto fica para a próxima execução
      var grupo = grupos[g];
      try {
        tratarConversa(grupo, eventos, ligacoes, hoje);
        Store.guardarEventos(eventos);
        limparFalhas(grupo.threadId);
      } catch (e) {
        console.error('Erro na conversa ' + grupo.threadId + ': ' + e.message);
        if (registarFalha(grupo.threadId) >= CONFIG.MAX_FALHAS) {
          Store.registar(grupo.mensagens, '', 'erro: ' + e.message);
          limparFalhas(grupo.threadId);
        }
      }
    }
    PropertiesService.getScriptProperties().setProperty('ULTIMA_SYNC', new Date().toISOString());
  } finally {
    lock.releaseLock();
  }
}

function tratarConversa(grupo, eventos, ligacoes, hoje) {
  var msgs = grupo.mensagens;
  var ev = null;
  var porId = function (id) { return eventos.filter(function (e) { return e.id === id; })[0] || null; };

  // a) Conversa já associada a um evento.
  if (ligacoes[grupo.threadId]) ev = porId(ligacoes[grupo.threadId]);

  // b) Assunto com a etiqueta [EVENTO] Nome.
  if (!ev) {
    var etiqueta = null;
    msgs.forEach(function (m) { etiqueta = etiqueta || Nucleo.nomeEventoDoAssunto(m.assunto); });
    if (etiqueta) {
      ev = eventos.filter(function (e) {
        return e.id === Nucleo.slug(etiqueta) || Nucleo.chave(e.nome) === Nucleo.chave(etiqueta);
      })[0] || criarEvento(eventos, etiqueta, msgs[0].data);
    }
  }

  // c) A IA decide.
  if (!ev) {
    var c = IA.chamar(Nucleo.SISTEMA_CLASSIFICACAO, Nucleo.pedidoClassificacao(eventos, msgs),
      Nucleo.ESQUEMA_CLASSIFICACAO, { esforco: CONFIG.ESFORCO_CLASSIFICACAO, maxTokens: 4000 });
    if (c.decisao === 'existente') ev = porId(c.evento_id);
    if (!ev && c.decisao !== 'ignorar' && String(c.nome_novo || '').trim()) {
      ev = criarEvento(eventos, c.nome_novo.trim(), msgs[0].data);
    }
    if (!ev) {
      Store.registar(msgs, '', 'ignorada: ' + (c.motivo || 'não é sobre um evento'));
      return;
    }
  }

  if (ligacoes[grupo.threadId] !== ev.id) {
    Store.ligarConversa(grupo.threadId, ev.id);
    ligacoes[grupo.threadId] = ev.id;
  }

  // Analisar por lotes, por ordem cronológica.
  for (var i = 0; i < msgs.length; i += CONFIG.MENSAGENS_POR_PEDIDO) {
    var lote = msgs.slice(i, i + CONFIG.MENSAGENS_POR_PEDIDO);
    var an = IA.chamar(Nucleo.SISTEMA_ANALISE, Nucleo.pedidoAnalise(ev, lote, hoje),
      Nucleo.ESQUEMA_ANALISE, { esforco: CONFIG.ESFORCO_ANALISE });
    var avisos = Nucleo.aplicarAnalise(ev, lote, an);
    Store.registar(lote, ev.nome, 'analisada');
    notificar(ev, avisos);
  }
}

function criarEvento(eventos, nome, dataIso) {
  var ev = Nucleo.novoEvento(nome, dataIso);
  ev.id = Nucleo.idUnico(ev.id, eventos.map(function (e) { return e.id; }));
  eventos.push(ev);
  return ev;
}

// ---------------------------------------------------------------- falhas

function registarFalha(threadId) {
  var p = PropertiesService.getScriptProperties();
  var n = +(p.getProperty('falhas:' + threadId) || 0) + 1;
  p.setProperty('falhas:' + threadId, String(n));
  return n;
}

function limparFalhas(threadId) {
  PropertiesService.getScriptProperties().deleteProperty('falhas:' + threadId);
}

// ---------------------------------------------------------------- emails enviados pela aplicação

function urlApp() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function emailPermitido(email) {
  return email && (!CONFIG.DOMINIOS_PERMITIDOS.length || CONFIG.DOMINIOS_PERMITIDOS.indexOf(Nucleo.dominio(email)) >= 0);
}

/** Avisa quem ficou com uma tarefa. O assunto leva [EVENTO] para que as respostas voltem ao evento certo. */
function notificar(ev, avisos) {
  if (!CONFIG.NOTIFICAR_ATRIBUICOES) return;
  var porPessoa = {};
  avisos.forEach(function (a) {
    if (a.tipo !== 'atribuicao' || !emailPermitido(a.pessoa && a.pessoa.email)) return;
    (porPessoa[a.pessoa.email] = porPessoa[a.pessoa.email] || { pessoa: a.pessoa, tarefas: [] }).tarefas.push(a.tarefa);
  });
  Object.keys(porPessoa).forEach(function (email) {
    var x = porPessoa[email];
    var lista = x.tarefas.map(function (t) {
      return '<li><b>' + esc(t.descricao) + '</b>' + (t.prazo ? ' — até ' + Nucleo.dataCurta(t.prazo) : '') + '</li>';
    }).join('');
    var html =
      '<p>Olá ' + esc(x.pessoa.nome.split(' ')[0]) + ',</p>' +
      '<p>Pelas mensagens trocadas sobre <b>' + esc(ev.nome) + '</b>, ficou responsável por:</p><ul>' + lista + '</ul>' +
      '<p>Se não estiver correto, ou quando estiver feito, basta <b>responder a este email</b> por palavras suas ' +
      '(por exemplo "já está tratado" ou "isto é com a Marta").</p>' +
      (urlApp() ? '<p><a href="' + urlApp() + '#' + encodeURIComponent(ev.id) + '">Ver o evento completo</a></p>' : '') +
      '<p style="color:#888;font-size:12px">' + esc(CONFIG.NOME_APP) + '</p>';
    GmailApp.sendEmail(email, '[EVENTO] ' + ev.nome, '', { htmlBody: html, name: CONFIG.NOME_APP });
  });
}

/** Segunda-feira de manhã: cada pessoa recebe as suas tarefas pendentes e o que está atrasado. */
function enviarResumoSemanal() {
  var eventos = Store.carregarEventos().filter(function (e) { return e.estado !== 'cancelado' && e.estado !== 'concluido'; });
  var hoje = Utilities.formatDate(new Date(), 'Europe/Lisbon', 'yyyy-MM-dd');
  var porPessoa = {};
  eventos.forEach(function (ev) {
    ev.tarefas.forEach(function (t) {
      if (t.estado !== 'pendente' || !t.responsavel || !emailPermitido(t.responsavel.email)) return;
      var e = t.responsavel.email;
      (porPessoa[e] = porPessoa[e] || { nome: t.responsavel.nome, itens: [] }).itens.push({ ev: ev, t: t });
    });
  });
  Object.keys(porPessoa).forEach(function (email) {
    var x = porPessoa[email];
    x.itens.sort(function (a, b) { return (a.t.prazo || '9999') < (b.t.prazo || '9999') ? -1 : 1; });
    var linhas = x.itens.map(function (i) {
      var atrasada = i.t.prazo && i.t.prazo < hoje;
      return '<li' + (atrasada ? ' style="color:#b42318"' : '') + '><b>' + esc(i.t.descricao) + '</b> — ' + esc(i.ev.nome) +
        (i.t.prazo ? ' (até ' + Nucleo.dataCurta(i.t.prazo) + (atrasada ? ', em atraso' : '') + ')' : '') + '</li>';
    }).join('');
    var html = '<p>Bom dia ' + esc(x.nome.split(' ')[0]) + ',</p><p>Estas são as suas tarefas pendentes nos eventos da escola:</p>' +
      '<ul>' + linhas + '</ul><p>Para dar uma tarefa como feita basta responder à conversa do evento, com eventos em cópia.</p>' +
      (urlApp() ? '<p><a href="' + urlApp() + '">Abrir ' + esc(CONFIG.NOME_APP) + '</a></p>' : '');
    GmailApp.sendEmail(email, CONFIG.NOME_APP + ' — as suas tarefas desta semana', '', { htmlBody: html, name: CONFIG.NOME_APP });
  });
}
