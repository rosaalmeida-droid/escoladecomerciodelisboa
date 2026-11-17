/**
 * IA.js — chamadas à API do Claude (Anthropic) por HTTP.
 * O Apps Script não tem SDK oficial, por isso usa-se UrlFetchApp diretamente.
 */
var IA = (function () {
  var URL = 'https://api.anthropic.com/v1/messages';

  function chaveApi() {
    var k = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
    if (!k) throw new Error('Falta configurar ANTHROPIC_API_KEY nas propriedades do script.');
    return k;
  }

  /**
   * sistema: instruções fixas; texto: pedido; esquema: JSON Schema (ou null para resposta em texto).
   * opcoes: { esforco, maxTokens }
   */
  function chamar(sistema, texto, esquema, opcoes) {
    opcoes = opcoes || {};
    var corpo = {
      model: CONFIG.MODELO,
      max_tokens: opcoes.maxTokens || 16000,
      system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: texto }],
      output_config: { effort: opcoes.esforco || 'medium' },
      // Se um filtro de segurança recusar o pedido, a API tenta automaticamente outro modelo.
      fallbacks: 'default'
    };
    if (esquema) corpo.output_config.format = { type: 'json_schema', schema: esquema };

    var pedido = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': chaveApi(),
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01'
      },
      payload: JSON.stringify(corpo),
      muteHttpExceptions: true
    };

    var resp, codigo, tentativa = 0;
    while (true) {
      resp = UrlFetchApp.fetch(URL, pedido);
      codigo = resp.getResponseCode();
      // 429 (limite), 5xx e 529 (sobrecarga) valem a pena repetir.
      var repetir = codigo === 429 || codigo >= 500;
      if (!repetir || tentativa >= 3) break;
      var espera = +(resp.getHeaders()['retry-after'] || resp.getHeaders()['Retry-After'] || 0);
      Utilities.sleep(Math.min(30, espera || Math.pow(2, tentativa) * 3) * 1000);
      tentativa++;
    }

    var dados;
    try { dados = JSON.parse(resp.getContentText()); } catch (e) { dados = null; }
    if (codigo !== 200) {
      var msg = dados && dados.error ? dados.error.type + ': ' + dados.error.message : resp.getContentText().slice(0, 300);
      throw new Error('API do Claude respondeu ' + codigo + ' — ' + msg);
    }
    if (dados.stop_reason === 'refusal') throw new Error('O modelo recusou analisar este conteúdo.');
    if (dados.stop_reason === 'max_tokens') throw new Error('Resposta da IA cortada (max_tokens).');

    var txt = dados.content.filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; }).join('');
    return esquema ? JSON.parse(txt) : txt.trim();
  }

  return { chamar: chamar };
})();
