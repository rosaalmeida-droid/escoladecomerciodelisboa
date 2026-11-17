// Teste de ponta a ponta da sincronização, com Gmail, Sheet e IA simulados.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function ambiente({ threads, respostasIA }) {
  const props = {};
  const enviados = [];
  const pedidosIA = [];
  const registo = [];
  let eventosGuardados = [];
  const conversas = {};

  const ctx = {
    console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => props[k] || null,
        setProperty: (k, v) => { props[k] = v; },
        deleteProperty: k => { delete props[k]; },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    Session: {
      getEffectiveUser: () => ({ getEmail: () => 'eventos@eclisboa.net' }),
      getActiveUser: () => ({ getEmail: () => 'ana.silva@eclisboa.net' }),
    },
    Utilities: { formatDate: () => '2026-11-17', sleep: () => {} },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/app' }) },
    GmailApp: {
      search: () => threads.map(t => ({
        getId: () => t.id,
        getMessages: () => t.msgs.map(m => ({
          getId: () => m.id, isInTrash: () => false, getFrom: () => m.de, getTo: () => m.para || '',
          getCc: () => m.cc || '', getDate: () => new Date(m.data), getSubject: () => t.assunto, getPlainBody: () => m.corpo,
        })),
      })),
      sendEmail: (to, assunto, txt, op) => enviados.push({ to, assunto, html: op.htmlBody }),
    },
    Store: {
      carregarEventos: () => JSON.parse(JSON.stringify(eventosGuardados)),
      guardarEventos: evs => { eventosGuardados = JSON.parse(JSON.stringify(evs)); },
      idsRegistados: () => Object.fromEntries(registo.map(r => [r.id, true])),
      registar: (msgs, ev, res) => msgs.forEach(m => registo.push({ id: m.id, ev, res })),
      conversas: () => ({ ...conversas }),
      ligarConversa: (t, e) => { conversas[t] = e; },
    },
    IA: {
      chamar: (sistema, texto, esquema) => {
        pedidosIA.push({ sistema, texto });
        const r = respostasIA.shift();
        if (r instanceof Error) throw r;
        return typeof r === 'function' ? r(texto) : r;
      },
    },
  };
  vm.createContext(ctx);
  for (const f of ['Config.js', 'Nucleo.js', 'Sincronizar.js', 'WebApp.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  return { ctx, enviados, pedidosIA, registo, conversas, eventos: () => eventosGuardados, props };
}

const vazia = extra => Object.assign({
  mensagens: [], informacao: { nome: null, data: null, hora: null, local: null, descricao: null, estado: null },
  coordenador: null, areas: [], saidas: [], tarefas_novas: [], tarefas_atualizadas: [], decisoes_novas: [],
  questoes_em_aberto: [], alertas: [], ponto_situacao: '',
}, extra);

test('sincronização: classifica, analisa, notifica, ignora o que deve e não repete', () => {
  const threads = [
    {
      id: 't1', assunto: 'Feira de emprego em março',
      msgs: [{
        id: 'm1', data: '2026-11-16T09:00:00Z', de: 'Ana Silva <ana.silva@eclisboa.net>',
        para: 'Rui Costa <rui.costa@eclisboa.net>', cc: 'eventos@eclisboa.net',
        corpo: 'Rui, consegues reservar o ginásio? Eu coordeno.',
      }],
    },
    { id: 't2', assunto: 'Newsletter', msgs: [{ id: 'm2', data: '2026-11-16T08:00:00Z', de: 'noticias@jornal.pt', corpo: 'Promoções' }] },
    { id: 't3', assunto: 'Almoço sexta?', msgs: [{ id: 'm3', data: '2026-11-16T10:00:00Z', de: 'joao.pinto@eclisboa.net', corpo: 'Vamos almoçar?' }] },
  ];
  const respostasIA = [
    { decisao: 'novo', evento_id: '', nome_novo: 'Feira de Emprego 2027', motivo: '' },
    vazia({
      mensagens: [{ id: 'm1', resumo: 'A Ana lançou a feira.' }],
      coordenador: { nome: 'Ana Silva', email: 'ana.silva@eclisboa.net' },
      tarefas_novas: [{ descricao: 'Reservar o ginásio', responsavel: { nome: 'Rui Costa', email: 'rui.costa@eclisboa.net' }, prazo: null, area: 'Logística', ja_concluida: false, mensagem_id: 'm1' }],
      ponto_situacao: 'Arranque.',
    }),
    { decisao: 'ignorar', evento_id: '', nome_novo: '', motivo: 'assunto pessoal' },
  ];
  const A = ambiente({ threads, respostasIA });
  A.ctx.sincronizar();

  const evs = A.eventos();
  assert.strictEqual(evs.length, 1);
  assert.strictEqual(evs[0].nome, 'Feira de Emprego 2027');
  assert.strictEqual(evs[0].tarefas[0].responsavel.email, 'rui.costa@eclisboa.net');
  assert.strictEqual(A.conversas.t1, 'feira-de-emprego-2027');
  assert.ok(!evs[0].pessoas.some(p => p.email === 'eventos@eclisboa.net'), 'a caixa de eventos não é uma pessoa do evento');
  const res = Object.fromEntries(A.registo.map(r => [r.id, r.res]));
  assert.strictEqual(res.m1, 'analisada');
  assert.strictEqual(res.m2, 'ignorada: remetente fora da escola');
  assert.strictEqual(res.m3, 'ignorada: assunto pessoal');
  assert.strictEqual(A.pedidosIA.length, 3, 'newsletter externa nem chega à IA');
  assert.strictEqual(A.enviados.length, 1);
  assert.strictEqual(A.enviados[0].to, 'rui.costa@eclisboa.net');
  assert.strictEqual(A.enviados[0].assunto, '[EVENTO] Feira de Emprego 2027');

  // Segunda passagem: nada de novo => nenhuma chamada à IA.
  A.ctx.sincronizar();
  assert.strictEqual(A.pedidosIA.length, 3);

  // Resposta do Rui à notificação: a etiqueta [EVENTO] leva-a ao evento sem classificação.
  threads.push({
    id: 't4', assunto: 'Re: [EVENTO] Feira de Emprego 2027',
    msgs: [
      { id: 'n1', data: '2026-11-16T11:00:00Z', de: 'eventos@eclisboa.net', corpo: 'aviso' },
      { id: 'm4', data: '2026-11-17T09:00:00Z', de: 'Rui Costa <rui.costa@eclisboa.net>', corpo: 'Já está reservado.' },
    ],
  });
  respostasIA.push(texto => {
    assert.match(texto, /#1 \[pendente\] Reservar o ginásio/);
    return vazia({ mensagens: [{ id: 'm4', resumo: 'Ginásio reservado.' }], tarefas_atualizadas: [{ id: 1, estado: 'concluida', responsavel: null, prazo: null, area: null, descricao: null }] });
  });
  A.ctx.sincronizar();
  assert.strictEqual(A.pedidosIA.length, 4);
  assert.strictEqual(A.eventos()[0].tarefas[0].estado, 'concluida');
  assert.strictEqual(A.registo.find(r => r.id === 'n1').res, 'ignorada: enviada pela caixa de eventos');

  // A app: dados para o navegador e correção manual.
  const dados = JSON.parse(A.ctx.api_dados());
  assert.strictEqual(dados.eventos[0].mensagens, undefined);
  const ev = JSON.parse(A.ctx.api_tarefa('feira-de-emprego-2027', 1, { estado: 'pendente' }));
  assert.strictEqual(ev.tarefas[0].estado, 'pendente');
  assert.match(ev.historico.at(-1).resumo, /reabriu a tarefa #1/);
});

test('sincronização: erros da IA repetem-se e só desistem ao fim de MAX_FALHAS', () => {
  const threads = [{ id: 't1', assunto: '[EVENTO] Festa', msgs: [{ id: 'm1', data: '2026-11-16T09:00:00Z', de: 'ana.silva@eclisboa.net', corpo: 'Olá' }] }];
  const A = ambiente({ threads, respostasIA: [new Error('API 529'), new Error('API 529'), new Error('API 529')] });
  A.ctx.sincronizar();
  A.ctx.sincronizar();
  assert.strictEqual(A.registo.length, 0, 'ainda vai tentar outra vez');
  A.ctx.sincronizar();
  assert.strictEqual(A.registo.length, 1);
  assert.match(A.registo[0].res, /^erro: API 529/);
});
