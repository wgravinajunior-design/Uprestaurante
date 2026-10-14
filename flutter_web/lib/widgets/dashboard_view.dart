import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// Dashboard gerencial: faturamento, pedidos, ticket médio, comparativo, horários de pico e mais vendidos.
class DashboardView extends StatefulWidget {
  const DashboardView({super.key});

  @override
  State<DashboardView> createState() => _DashboardViewState();
}

enum _Periodo { hoje, sete, trinta, mesAtual, mesAnterior, personalizado }

class _DashboardViewState extends State<DashboardView> {
  _Periodo _periodo = _Periodo.sete;
  DateTime _inicio = DateTime.now();
  DateTime _fim = DateTime.now();
  String _comparar = 'ANTERIOR';

  Map<String, dynamic>? _dados;
  bool _carregando = true;
  String? _erro;
  int _topAba = 0; // 0 = quantidade, 1 = faturamento
  int _seq = 0;

  final _money = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
  final _data = DateFormat('dd/MM/yyyy');
  final _dataCurta = DateFormat('dd/MM');
  final _iso = DateFormat('yyyy-MM-dd');

  @override
  void initState() {
    super.initState();
    _aplicarPreset(_Periodo.sete, carregar: false);
    _carregar();
    ApiService.reconnected.addListener(_onReconnected);
  }

  @override
  void dispose() {
    ApiService.reconnected.removeListener(_onReconnected);
    super.dispose();
  }

  void _onReconnected() {
    if (mounted) _carregar();
  }

  DateTime _hoje() {
    final n = DateTime.now();
    return DateTime(n.year, n.month, n.day);
  }

  void _aplicarPreset(_Periodo p, {bool carregar = true}) {
    final h = _hoje();
    setState(() {
      _periodo = p;
      switch (p) {
        case _Periodo.hoje:
          _inicio = h;
          _fim = h;
          break;
        case _Periodo.sete:
          _fim = h;
          _inicio = h.subtract(const Duration(days: 6));
          break;
        case _Periodo.trinta:
          _fim = h;
          _inicio = h.subtract(const Duration(days: 29));
          break;
        case _Periodo.mesAtual:
          _inicio = DateTime(h.year, h.month, 1);
          _fim = h;
          break;
        case _Periodo.mesAnterior:
          _inicio = DateTime(h.year, h.month - 1, 1);
          _fim = DateTime(h.year, h.month, 0);
          break;
        case _Periodo.personalizado:
          break;
      }
    });
    if (carregar) _carregar();
  }

  Future<void> _escolherIntervalo() async {
    final h = _hoje();
    final r = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2015),
      lastDate: h,
      initialDateRange: DateTimeRange(start: _inicio, end: _fim.isAfter(h) ? h : _fim),
      locale: const Locale('pt', 'BR'),
      helpText: 'Escolha o período',
      saveText: 'Aplicar',
    );
    if (r == null) return;
    setState(() {
      _periodo = _Periodo.personalizado;
      _inicio = r.start;
      _fim = r.end;
    });
    _carregar();
  }

  Future<void> _carregar() async {
    final minhaVez = ++_seq;
    setState(() {
      _carregando = true;
      _erro = null;
    });
    try {
      final d = await ApiService.getDashboard(
        inicio: _iso.format(_inicio),
        fim: _iso.format(_fim),
        comparar: _comparar,
      );
      if (!mounted || minhaVez != _seq) return;
      setState(() {
        _dados = d;
        _carregando = false;
      });
    } catch (e) {
      if (!mounted || minhaVez != _seq) return;
      setState(() {
        _erro = e.toString().replaceAll('Exception: ', '');
        _carregando = false;
      });
    }
  }

  // ---------------------------------------------------------------- helpers
  double _n(dynamic v) => (v as num?)?.toDouble() ?? 0;
  int _i(dynamic v) => (v as num?)?.toInt() ?? 0;

  @override
  Widget build(BuildContext context) {
    final isMobile = MediaQuery.of(context).size.width < 900;
    return SingleChildScrollView(
      padding: EdgeInsets.symmetric(horizontal: isMobile ? 12 : 24, vertical: isMobile ? 12 : 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _cabecalho(),
          const SizedBox(height: 14),
          _filtros(),
          const SizedBox(height: 16),
          if (_erro != null && _dados == null) _estadoErro() else if (_dados == null) const Padding(
            padding: EdgeInsets.all(60),
            child: Center(child: CircularProgressIndicator(color: AppTheme.primary)),
          ) else ...[
            if (_carregando) const LinearProgressIndicator(minHeight: 2, color: AppTheme.primary),
            _conteudo(_dados!, isMobile),
          ],
        ],
      ),
    );
  }

  Widget _cabecalho() {
    return Row(
      children: [
        const Icon(Icons.insights, color: AppTheme.primary, size: 26),
        const SizedBox(width: 10),
        const Expanded(
          child: Text('Dashboard gerencial',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
        ),
        IconButton(
          tooltip: 'Atualizar',
          icon: const Icon(Icons.refresh, color: AppTheme.textSecondary),
          onPressed: _carregando ? null : _carregar,
        ),
      ],
    );
  }

  Widget _filtros() {
    Widget chip(_Periodo p, String rotulo) {
      final sel = _periodo == p;
      return ChoiceChip(
        label: Text(rotulo,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: sel ? Colors.white : AppTheme.textPrimary)),
        selected: sel,
        selectedColor: AppTheme.primary,
        backgroundColor: AppTheme.surfaceWhite,
        showCheckmark: false,
        onSelected: (_) => p == _Periodo.personalizado ? _escolherIntervalo() : _aplicarPreset(p),
      );
    }

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        chip(_Periodo.hoje, 'Hoje'),
        chip(_Periodo.sete, '7 dias'),
        chip(_Periodo.trinta, '30 dias'),
        chip(_Periodo.mesAtual, 'Mês atual'),
        chip(_Periodo.mesAnterior, 'Mês anterior'),
        chip(_Periodo.personalizado, 'Escolher datas…'),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: AppTheme.surfaceWhite,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppTheme.borderLight),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: _comparar,
              items: const [
                DropdownMenuItem(value: 'ANTERIOR', child: Text('Comparar: período anterior', style: TextStyle(fontSize: 12))),
                DropdownMenuItem(value: 'SEMANA', child: Text('Comparar: 7 dias antes', style: TextStyle(fontSize: 12))),
                DropdownMenuItem(value: 'NENHUM', child: Text('Sem comparação', style: TextStyle(fontSize: 12))),
              ],
              onChanged: (v) {
                if (v == null) return;
                setState(() => _comparar = v);
                _carregar();
              },
            ),
          ),
        ),
        Text(
          '${_data.format(_inicio)} → ${_data.format(_fim)}',
          style: const TextStyle(fontSize: 12, color: AppTheme.textMuted, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }

  Widget _estadoErro() {
    return Padding(
      padding: const EdgeInsets.all(40),
      child: Center(
        child: Column(
          children: [
            const Icon(Icons.cloud_off, size: 44, color: AppTheme.dangerLight),
            const SizedBox(height: 10),
            Text(_erro ?? 'Erro', style: const TextStyle(color: AppTheme.dangerLight)),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _carregar, child: const Text('Tentar novamente')),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- conteudo
  Widget _conteudo(Map<String, dynamic> d, bool isMobile) {
    final atual = d['atual'] as Map<String, dynamic>;
    final variacao = d['variacao'] as Map<String, dynamic>?;
    final anterior = d['anterior'] as Map<String, dynamic>?;
    final semVendas = _i(atual['pedidos']) == 0;

    if (semVendas) return _semVendas(d);

    final kpis = [
      _kpi('Faturamento', _money.format(_n(atual['faturamento'])), Icons.payments_outlined, AppTheme.successLight,
          variacao == null ? null : variacao['faturamento'],
          anterior == null ? null : 'antes: ${_money.format(_n(anterior['faturamento']))}'),
      _kpi('Pedidos', '${_i(atual['pedidos'])}', Icons.receipt_long_outlined, const Color(0xFF2563EB),
          variacao == null ? null : variacao['pedidos'], anterior == null ? null : 'antes: ${_i(anterior['pedidos'])}'),
      _kpi('Ticket médio', _money.format(_n(atual['ticketMedio'])), Icons.shopping_bag_outlined, AppTheme.primary,
          variacao == null ? null : variacao['ticketMedio'],
          anterior == null ? null : 'antes: ${_money.format(_n(anterior['ticketMedio']))}'),
    ];

    final pico = d['picoHora'] as Map<String, dynamic>?;
    final melhor = d['melhorDia'] as Map<String, dynamic>?;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 10),
        LayoutBuilder(builder: (ctx, c) {
          final cols = c.maxWidth > 800 ? 3 : (c.maxWidth > 520 ? 2 : 1);
          final w = (c.maxWidth - (cols - 1) * 12) / cols;
          return Wrap(spacing: 12, runSpacing: 12, children: kpis.map((k) => SizedBox(width: w, child: k)).toList());
        }),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            if (pico != null) _insight(Icons.schedule, 'Pico de vendas às ${_i(pico['hora'])}h (${_i(pico['pedidos'])} pedidos)'),
            if (melhor != null)
              _insight(Icons.emoji_events_outlined,
                  'Melhor dia: ${_dataCurta.format(DateTime.parse(melhor['data']))} (${_money.format(_n(melhor['faturamento']))})'),
          ],
        ),
        const SizedBox(height: 16),
        _cartao('Vendas por dia', _graficoDias(d), subtitulo: anterior != null ? 'Barras claras = período de comparação' : null),
        const SizedBox(height: 16),
        LayoutBuilder(builder: (ctx, c) {
          final lado = c.maxWidth > 820;
          final horas = _cartao('Horários de pico (pedidos por hora)', _graficoHoras(d));
          final semana = _cartao('Média de faturamento por dia da semana', _graficoSemana(d));
          if (!lado) return Column(children: [horas, const SizedBox(height: 16), semana]);
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [Expanded(child: horas), const SizedBox(width: 16), Expanded(child: semana)],
          );
        }),
        const SizedBox(height: 16),
        _cartao('Mais vendidos', _topProdutos(d)),
        const SizedBox(height: 24),
      ],
    );
  }

  Widget _semVendas(Map<String, dynamic> d) {
    final ultima = d['ultimaVenda'] as String?;
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: AppTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Column(
        children: [
          const Icon(Icons.bar_chart, size: 48, color: AppTheme.textMuted),
          const SizedBox(height: 10),
          const Text('Nenhuma venda finalizada neste período.',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
          if (ultima != null) ...[
            const SizedBox(height: 6),
            Text('Última venda registrada: ${_data.format(DateTime.parse(ultima))}',
                style: const TextStyle(color: AppTheme.textSecondary)),
            const SizedBox(height: 14),
            ElevatedButton.icon(
              icon: const Icon(Icons.calendar_month, size: 18),
              label: const Text('Ver o mês da última venda'),
              onPressed: () {
                final u = DateTime.parse(ultima);
                setState(() {
                  _periodo = _Periodo.personalizado;
                  _inicio = DateTime(u.year, u.month, 1);
                  _fim = DateTime(u.year, u.month + 1, 0);
                });
                _carregar();
              },
            ),
          ],
        ],
      ),
    );
  }

  Widget _kpi(String titulo, String valor, IconData icone, Color cor, dynamic variacao, String? rodape) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(7),
                decoration: BoxDecoration(color: cor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                child: Icon(icone, size: 18, color: cor),
              ),
              const SizedBox(width: 10),
              Text(titulo, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppTheme.textSecondary)),
              const Spacer(),
              _badgeVariacao(variacao),
            ],
          ),
          const SizedBox(height: 10),
          Text(valor, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: AppTheme.textPrimary)),
          if (rodape != null) ...[
            const SizedBox(height: 2),
            Text(rodape, style: const TextStyle(fontSize: 11.5, color: AppTheme.textMuted)),
          ],
        ],
      ),
    );
  }

  Widget _badgeVariacao(dynamic v) {
    if (v == null) return const SizedBox.shrink();
    final n = (v as num).toDouble();
    final sobe = n >= 0;
    final cor = sobe ? AppTheme.successLight : AppTheme.dangerLight;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(color: cor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(sobe ? Icons.arrow_upward : Icons.arrow_downward, size: 12, color: cor),
          const SizedBox(width: 2),
          Text('${n.abs().toStringAsFixed(n.abs() < 10 ? 1 : 0)}%',
              style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: cor)),
        ],
      ),
    );
  }

  Widget _insight(IconData i, String t) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: AppTheme.primaryLighter, borderRadius: BorderRadius.circular(10)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(i, size: 15, color: AppTheme.primary),
          const SizedBox(width: 6),
          Text(t, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.primary)),
        ],
      ),
    );
  }

  Widget _cartao(String titulo, Widget filho, {String? subtitulo}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(titulo, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: AppTheme.textPrimary)),
          if (subtitulo != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(subtitulo, style: const TextStyle(fontSize: 11.5, color: AppTheme.textMuted)),
            ),
          const SizedBox(height: 14),
          filho,
        ],
      ),
    );
  }

  // ---------------------------------------------------------------- graficos
  /// Barras simples: [valores] com rótulos opcionais e um segundo conjunto [comparacao] (mais claro).
  Widget _barras({
    required List<double> valores,
    required List<String> rotulos,
    required List<String> dicas,
    List<double>? comparacao,
    Color cor = AppTheme.primary,
    double altura = 150,
    int? destaque,
  }) {
    final maximo = [
      ...valores,
      ...?comparacao,
    ].fold<double>(0, math.max);
    final max = maximo <= 0 ? 1.0 : maximo;
    final passo = (valores.length / 8).ceil().clamp(1, 1000);

    return Column(
      children: [
        SizedBox(
          height: altura,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (var i = 0; i < valores.length; i++)
                Expanded(
                  child: Tooltip(
                    message: dicas[i],
                    child: Padding(
                      padding: EdgeInsets.symmetric(horizontal: valores.length > 40 ? 0.5 : 2),
                      child: Stack(
                        alignment: Alignment.bottomCenter,
                        children: [
                          if (comparacao != null && i < comparacao.length)
                            FractionallySizedBox(
                              heightFactor: (comparacao[i] / max).clamp(0.0, 1.0),
                              child: Container(
                                decoration: BoxDecoration(
                                  color: cor.withValues(alpha: 0.22),
                                  borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
                                ),
                              ),
                            ),
                          FractionallySizedBox(
                            heightFactor: (valores[i] / max).clamp(0.0, 1.0),
                            child: Container(
                              decoration: BoxDecoration(
                                color: destaque == i ? AppTheme.successLight : cor,
                                borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            for (var i = 0; i < rotulos.length; i++)
              Expanded(
                child: Text(
                  i % passo == 0 ? rotulos[i] : '',
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.clip,
                  style: const TextStyle(fontSize: 9.5, color: AppTheme.textMuted),
                ),
              ),
          ],
        ),
      ],
    );
  }

  Widget _graficoDias(Map<String, dynamic> d) {
    final dias = (d['porDia'] as List).cast<Map<String, dynamic>>();
    final ant = (d['porDiaAnterior'] as List?)?.cast<Map<String, dynamic>>();

    // períodos longos: agrupa por semana para a leitura
    if (dias.length > 62) {
      final valores = <double>[];
      final comp = <double>[];
      final rot = <String>[];
      final dicas = <String>[];
      for (var i = 0; i < dias.length; i += 7) {
        final fim = math.min(i + 7, dias.length);
        final soma = dias.sublist(i, fim).fold<double>(0, (s, x) => s + _n(x['faturamento']));
        valores.add(soma);
        if (ant != null) {
          comp.add(ant.sublist(math.min(i, ant.length), math.min(fim, ant.length)).fold<double>(0, (s, x) => s + _n(x['faturamento'])));
        }
        final ini = DateTime.parse(dias[i]['data']);
        rot.add(_dataCurta.format(ini));
        dicas.add('Semana de ${_dataCurta.format(ini)}: ${_money.format(soma)}');
      }
      return _barras(valores: valores, rotulos: rot, dicas: dicas, comparacao: ant != null ? comp : null);
    }

    final valores = dias.map((x) => _n(x['faturamento'])).toList();
    final melhor = valores.isEmpty ? null : valores.indexOf(valores.reduce(math.max));
    return _barras(
      valores: valores,
      rotulos: dias.map((x) => _dataCurta.format(DateTime.parse(x['data']))).toList(),
      dicas: dias
          .map((x) => '${_data.format(DateTime.parse(x['data']))}: ${_money.format(_n(x['faturamento']))} (${_i(x['pedidos'])} pedidos)')
          .toList(),
      comparacao: ant?.map((x) => _n(x['faturamento'])).toList(),
      destaque: melhor,
    );
  }

  Widget _graficoHoras(Map<String, dynamic> d) {
    final horas = (d['porHora'] as List).cast<Map<String, dynamic>>();
    final comVenda = horas.where((h) => _i(h['pedidos']) > 0).map((h) => _i(h['hora'])).toList();
    if (comVenda.isEmpty) return const Text('Sem dados');
    final ini = comVenda.reduce(math.min);
    final fim = comVenda.reduce(math.max);
    final faixa = horas.where((h) => _i(h['hora']) >= ini && _i(h['hora']) <= fim).toList();
    final valores = faixa.map((h) => _n(h['pedidos'])).toList();
    final pico = valores.indexOf(valores.reduce(math.max));
    return _barras(
      valores: valores,
      rotulos: faixa.map((h) => '${_i(h['hora'])}h').toList(),
      dicas: faixa.map((h) => '${_i(h['hora'])}h: ${_i(h['pedidos'])} pedidos • ${_money.format(_n(h['faturamento']))}').toList(),
      cor: const Color(0xFF2563EB),
      destaque: pico,
    );
  }

  Widget _graficoSemana(Map<String, dynamic> d) {
    final sem = (d['porDiaSemana'] as List).cast<Map<String, dynamic>>();
    final valores = sem.map((x) => _n(x['mediaFaturamento'])).toList();
    if (valores.every((v) => v == 0)) return const Text('Sem dados');
    return _barras(
      valores: valores,
      rotulos: sem.map((x) => (x['nome'] as String).substring(0, 3)).toList(),
      dicas: sem
          .map((x) => '${x['nome']}: média ${_money.format(_n(x['mediaFaturamento']))}/dia • ${_i(x['pedidos'])} pedidos no período')
          .toList(),
      cor: const Color(0xFF7C3AED),
      destaque: valores.indexOf(valores.reduce(math.max)),
    );
  }

  Widget _topProdutos(Map<String, dynamic> d) {
    final porQtd = _topAba == 0;
    final lista = ((porQtd ? d['topQuantidade'] : d['topFaturamento']) as List).cast<Map<String, dynamic>>();
    if (lista.isEmpty) return const Text('Sem dados');
    final max = lista.map((x) => _n(porQtd ? x['quantidade'] : x['faturamento'])).reduce(math.max);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          children: [
            ChoiceChip(
              label: Text('Por quantidade', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: porQtd ? Colors.white : AppTheme.textPrimary)),
              selected: porQtd,
              selectedColor: AppTheme.primary,
              showCheckmark: false,
              onSelected: (_) => setState(() => _topAba = 0),
            ),
            ChoiceChip(
              label: Text('Por faturamento', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: !porQtd ? Colors.white : AppTheme.textPrimary)),
              selected: !porQtd,
              selectedColor: AppTheme.primary,
              showCheckmark: false,
              onSelected: (_) => setState(() => _topAba = 1),
            ),
          ],
        ),
        const SizedBox(height: 12),
        for (var i = 0; i < lista.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              children: [
                SizedBox(
                  width: 24,
                  child: Text('${i + 1}º', style: const TextStyle(fontWeight: FontWeight.w800, color: AppTheme.textMuted, fontSize: 12)),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(lista[i]['descricao'] as String,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                      const SizedBox(height: 4),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          minHeight: 7,
                          value: max <= 0 ? 0 : _n(porQtd ? lista[i]['quantidade'] : lista[i]['faturamento']) / max,
                          backgroundColor: AppTheme.borderLight,
                          color: porQtd ? AppTheme.primary : AppTheme.successLight,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                SizedBox(
                  width: 110,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        porQtd ? '${_n(lista[i]['quantidade']).toStringAsFixed(0)} un' : _money.format(_n(lista[i]['faturamento'])),
                        style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13),
                      ),
                      Text(
                        porQtd ? _money.format(_n(lista[i]['faturamento'])) : '${_n(lista[i]['quantidade']).toStringAsFixed(0)} un',
                        style: const TextStyle(fontSize: 11, color: AppTheme.textMuted),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
