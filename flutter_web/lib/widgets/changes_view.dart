import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'feedback_widgets.dart';

/// "O que mudou hoje": preços, promoções, estoque e status alterados no dia (ERP e este sistema).
class ChangesView extends StatefulWidget {
  const ChangesView({super.key});

  @override
  State<ChangesView> createState() => _ChangesViewState();
}

class _ChangesViewState extends State<ChangesView> {
  DateTime _dia = DateTime.now();
  Map<String, dynamic>? _dados;
  bool _carregando = true;
  String? _erro;
  String _tipo = 'TODOS';
  String _busca = '';
  int _seq = 0;

  final _data = DateFormat("EEEE, dd 'de' MMMM 'de' yyyy", 'pt_BR');
  final _iso = DateFormat('yyyy-MM-dd');

  static const _tipos = {
    'PRECO': ['Preço', Icons.attach_money, Color(0xFF2563EB)],
    'PROMOCAO': ['Promoção', Icons.local_fire_department, AppTheme.primary],
    'ESTOQUE': ['Estoque', Icons.inventory_2_outlined, Color(0xFF7C3AED)],
    'STATUS': ['Status', Icons.toggle_on_outlined, AppTheme.successLight],
    'FOTO': ['Foto', Icons.photo_outlined, Color(0xFF0891B2)],
    'CADASTRO': ['Cadastro', Icons.edit_note, AppTheme.textSecondary],
    'ALTERADO': ['Alterado', Icons.history, AppTheme.textMuted],
  };

  @override
  void initState() {
    super.initState();
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

  Future<void> _carregar() async {
    final minhaVez = ++_seq;
    setState(() {
      _carregando = true;
      _erro = null;
    });
    try {
      final d = await ApiService.getChanges(_iso.format(_dia));
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

  bool get _ehHoje {
    final n = DateTime.now();
    return _dia.year == n.year && _dia.month == n.month && _dia.day == n.day;
  }

  void _mudarDia(int delta) {
    final novo = _dia.add(Duration(days: delta));
    if (novo.isAfter(DateTime.now())) return;
    setState(() => _dia = novo);
    _carregar();
  }

  Future<void> _escolherDia() async {
    final p = await showDatePicker(
      context: context,
      initialDate: _dia,
      firstDate: DateTime(2015),
      lastDate: DateTime.now(),
      locale: const Locale('pt', 'BR'),
      helpText: 'Escolha o dia',
      cancelText: 'Cancelar',
      confirmText: 'Confirmar',
    );
    if (p == null) return;
    setState(() => _dia = p);
    _carregar();
  }

  List<Map<String, dynamic>> get _itens {
    final todos = ((_dados?['itens'] as List?) ?? []).cast<Map<String, dynamic>>();
    final termo = _busca.trim().toLowerCase();
    return todos.where((i) {
      if (_tipo != 'TODOS' && i['tipo'] != _tipo) return false;
      if (termo.isEmpty) return true;
      return '${i['produto']} ${i['campo']} ${i['usuario']}'.toLowerCase().contains(termo);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final isMobile = MediaQuery.of(context).size.width < 900;
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: isMobile ? 12 : 24, vertical: isMobile ? 12 : 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _cabecalho(),
          const SizedBox(height: 12),
          if (_dados != null) _resumo(),
          const SizedBox(height: 10),
          Expanded(child: _corpo()),
        ],
      ),
    );
  }

  Widget _cabecalho() {
    final nomeDia = toBeginningOfSentenceCase(_data.format(_dia));
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        const Icon(Icons.fact_check_outlined, color: AppTheme.primary, size: 24),
        const Text('O que mudou', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
        IconButton(
          tooltip: 'Dia anterior',
          icon: const Icon(Icons.chevron_left),
          onPressed: () => _mudarDia(-1),
        ),
        OutlinedButton.icon(
          onPressed: _escolherDia,
          icon: const Icon(Icons.calendar_today, size: 16),
          label: Text(_ehHoje ? 'Hoje — $nomeDia' : nomeDia, style: const TextStyle(fontSize: 12.5)),
        ),
        IconButton(
          tooltip: 'Próximo dia',
          icon: const Icon(Icons.chevron_right),
          onPressed: _ehHoje ? null : () => _mudarDia(1),
        ),
        IconButton(
          tooltip: 'Atualizar',
          icon: const Icon(Icons.refresh, color: AppTheme.textSecondary),
          onPressed: _carregando ? null : _carregar,
        ),
      ],
    );
  }

  Widget _resumo() {
    final porTipo = (_dados!['porTipo'] as Map?)?.cast<String, dynamic>() ?? {};
    final total = (_dados!['total'] as num?)?.toInt() ?? 0;
    final prods = (_dados!['produtosAfetados'] as num?)?.toInt() ?? 0;

    Widget chip(String valor, String rotulo, int n, {IconData? icone, Color? cor}) {
      final sel = _tipo == valor;
      return ChoiceChip(
        avatar: icone != null ? Icon(icone, size: 15, color: sel ? Colors.white : cor) : null,
        label: Text('$rotulo ($n)',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: sel ? Colors.white : AppTheme.textPrimary)),
        selected: sel,
        selectedColor: AppTheme.primary,
        backgroundColor: AppTheme.surfaceWhite,
        showCheckmark: false,
        onSelected: (_) => setState(() => _tipo = valor),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          total == 0
              ? 'Nenhuma alteração registrada neste dia.'
              : '$total alteração(ões) em $prods produto(s)',
          style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            chip('TODOS', 'Todas', total),
            for (final e in _tipos.entries)
              if ((porTipo[e.key] as num?) != null && (porTipo[e.key] as num) > 0)
                chip(e.key, e.value[0] as String, (porTipo[e.key] as num).toInt(),
                    icone: e.value[1] as IconData, cor: e.value[2] as Color),
            SizedBox(
              width: 220,
              child: TextField(
                onChanged: (v) => setState(() => _busca = v),
                decoration: const InputDecoration(
                  hintText: 'Filtrar produto ou usuário…',
                  prefixIcon: Icon(Icons.search, size: 18),
                  isDense: true,
                  contentPadding: EdgeInsets.symmetric(vertical: 10),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _corpo() {
    if (_carregando && _dados == null) {
      return const SkeletonList();
    }
    if (_erro != null && _dados == null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off, size: 44, color: AppTheme.dangerLight),
            const SizedBox(height: 10),
            Text(_erro!, style: const TextStyle(color: AppTheme.dangerLight)),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _carregar, child: const Text('Tentar novamente')),
          ],
        ),
      );
    }
    final itens = _itens;
    if (itens.isEmpty) {
      return Center(
        child: Text(
          (_dados?['total'] ?? 0) == 0 ? 'Sem alterações neste dia.' : 'Nada encontrado com esse filtro.',
          style: const TextStyle(color: AppTheme.textSecondary),
        ),
      );
    }
    return ListView.separated(
      itemCount: itens.length,
      separatorBuilder: (ctx, i) => const SizedBox(height: 6),
      itemBuilder: (ctx, i) => _linha(itens[i]),
    );
  }

  Widget _linha(Map<String, dynamic> i) {
    final meta = _tipos[i['tipo']] ?? _tipos['CADASTRO']!;
    final cor = meta[2] as Color;
    final de = (i['de'] ?? '').toString();
    final para = (i['para'] ?? '').toString();
    final detalhe = (i['detalhe'] ?? '').toString();
    final usuario = (i['usuario'] ?? '').toString();
    final origem = (i['origem'] ?? '').toString();

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: cor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: Icon(meta[1] as IconData, size: 18, color: cor),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(i['produto'].toString(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5)),
                const SizedBox(height: 2),
                Text(i['campo'].toString(), style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                if (detalhe.isNotEmpty)
                  Text(detalhe, style: const TextStyle(fontSize: 11.5, color: AppTheme.textMuted)),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Flexible(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (de.isNotEmpty) ...[
                  Flexible(child: _valor(de, AppTheme.dangerBg, AppTheme.dangerLight)),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 4),
                    child: Icon(Icons.arrow_forward, size: 14, color: AppTheme.textMuted),
                  ),
                ],
                if (para.isNotEmpty) Flexible(child: _valor(para, AppTheme.successBg, AppTheme.successLight, forte: true)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          SizedBox(
            width: 92,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(i['hora'].toString(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                Text(
                  usuario.isNotEmpty ? usuario : origem,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10.5, color: AppTheme.textMuted),
                ),
                Container(
                  margin: const EdgeInsets.only(top: 2),
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: origem == 'ERP' ? const Color(0xFFE0F2FE) : AppTheme.primaryLighter,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(origem,
                      style: TextStyle(
                          fontSize: 10, fontWeight: FontWeight.w800, color: origem == 'ERP' ? const Color(0xFF0369A1) : AppTheme.primary)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _valor(String t, Color bg, Color fg, {bool forte = false}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
      child: Text(
        t,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(fontSize: 11.5, color: fg, fontWeight: forte ? FontWeight.bold : FontWeight.w500),
      ),
    );
  }
}
