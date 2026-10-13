import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// Agenda uma promoção para uma data futura ("promoção da sexta").
/// Retorna o resultado da API ({ modo: 'DIRETO' | 'AGENDADA', ... }) ou null se cancelado.
Future<Map<String, dynamic>?> showSchedulePromoDialog(BuildContext context, {Product? produto}) {
  return showDialog<Map<String, dynamic>>(
    context: context,
    builder: (ctx) => SchedulePromoDialog(produto: produto),
  );
}

class SchedulePromoDialog extends StatefulWidget {
  final Product? produto;

  const SchedulePromoDialog({super.key, this.produto});

  @override
  State<SchedulePromoDialog> createState() => _SchedulePromoDialogState();
}

class _SchedulePromoDialogState extends State<SchedulePromoDialog> {
  final _busca = TextEditingController();
  final _desconto = TextEditingController(text: '15');
  final _fmtData = DateFormat('dd/MM/yyyy');
  final _fmtIso = DateFormat('yyyy-MM-dd');
  final _money = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

  Product? _produto;
  List<Product> _resultados = [];
  bool _buscando = false;
  Timer? _debounce;

  DateTime? _inicio;
  DateTime? _fim;
  bool _salvando = false;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _produto = widget.produto;
    // sugestão: próxima sexta-feira
    final now = DateTime.now();
    final dias = (DateTime.friday - now.weekday + 7) % 7;
    _inicio = DateTime(now.year, now.month, now.day).add(Duration(days: dias == 0 ? 7 : dias));
    _fim = _inicio;
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _busca.dispose();
    _desconto.dispose();
    super.dispose();
  }

  void _onBusca(String v) {
    _debounce?.cancel();
    if (v.trim().length < 2) {
      setState(() => _resultados = []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      setState(() => _buscando = true);
      try {
        final res = await ApiService.getProducts(search: v.trim(), pageSize: 8);
        if (!mounted) return;
        setState(() => _resultados = (res['items'] as List).cast<Product>());
      } catch (_) {
        if (mounted) setState(() => _resultados = []);
      } finally {
        if (mounted) setState(() => _buscando = false);
      }
    });
  }

  Future<void> _escolherData({required bool inicio}) async {
    final now = DateTime.now();
    final base = (inicio ? _inicio : _fim) ?? now;
    final picked = await showDatePicker(
      context: context,
      initialDate: base.isBefore(now) ? now : base,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: DateTime(now.year + 3),
      locale: const Locale('pt', 'BR'),
      helpText: inicio ? 'Início da promoção' : 'Término da promoção',
      cancelText: 'Cancelar',
      confirmText: 'Confirmar',
    );
    if (picked == null) return;
    setState(() {
      if (inicio) {
        _inicio = picked;
        if (_fim != null && _fim!.isBefore(picked)) _fim = picked;
      } else {
        _fim = picked;
      }
    });
  }

  double? get _pct => double.tryParse(_desconto.text.trim().replaceAll(',', '.'));

  double? get _precoPrevisto {
    final p = _produto;
    final d = _pct;
    if (p == null || d == null || p.precoVenda <= 0) return null;
    return (p.precoVenda * (1 - d / 100) * 100).round() / 100;
  }

  Future<void> _salvar({bool forcar = false}) async {
    final p = _produto;
    if (p == null) {
      setState(() => _erro = 'Escolha o produto.');
      return;
    }
    final d = _pct;
    if (d == null || d < 1 || d > 90) {
      setState(() => _erro = 'O desconto deve estar entre 1% e 90%.');
      return;
    }
    if (_inicio == null) {
      setState(() => _erro = 'Informe a data de início.');
      return;
    }

    setState(() {
      _salvando = true;
      _erro = null;
    });
    try {
      final r = await ApiService.schedulePromotion(
        produtoId: p.id,
        percentual: d,
        dtInicio: _fmtIso.format(_inicio!),
        dtFim: _fim != null ? _fmtIso.format(_fim!) : null,
        forcar: forcar,
      );
      if (!mounted) return;
      Navigator.pop(context, r);
    } on ScheduleConflict catch (c) {
      if (!mounted) return;
      setState(() => _salvando = false);
      final seguir = await _confirmarConflito(c);
      if (seguir == true && mounted) await _salvar(forcar: true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _salvando = false;
        _erro = e.toString().replaceAll('Exception: ', '');
      });
    }
  }

  String _periodo(Map c) {
    final ini = c['dtInicio']?.toString();
    final fim = c['dtFim']?.toString();
    String f(String? s) => s == null || s.isEmpty ? '—' : _fmtData.format(DateTime.parse(s));
    return '${f(ini)} → ${fim == null || fim.isEmpty ? 'sem término' : f(fim)}';
  }

  Future<bool?> _confirmarConflito(ScheduleConflict c) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: AppTheme.warningLight),
            SizedBox(width: 10),
            Expanded(child: Text('Conflito de promoção')),
          ],
        ),
        content: SizedBox(
          width: 440,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('"${c.produto}" já tem promoção neste período:', style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 10),
              for (final item in c.conflitos)
                Container(
                  margin: const EdgeInsets.only(bottom: 6),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppTheme.warningBg,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '${item['tipo'] == 'AGENDADA' ? 'Agendada' : (item['situacao'] == 'FUTURA' ? 'Futura' : 'Em vigor')}: '
                    '${_money.format((item['precoPromocao'] as num?) ?? 0)}  •  ${_periodo(item as Map)}',
                    style: const TextStyle(fontSize: 12.5),
                  ),
                ),
              const SizedBox(height: 8),
              const Text(
                'Ao continuar, a nova promoção substitui os agendamentos conflitantes. A promoção que está valendo hoje '
                'continua até o dia do início da nova.',
                style: TextStyle(fontSize: 12.5, color: AppTheme.textSecondary),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Voltar')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Agendar mesmo assim')),
        ],
      ),
    );
  }

  Widget _botaoData(String rotulo, DateTime? data, {required bool inicio}) {
    return Expanded(
      child: OutlinedButton.icon(
        onPressed: () => _escolherData(inicio: inicio),
        icon: Icon(inicio ? Icons.event_available : Icons.event_busy, size: 18),
        label: Text(
          data != null ? '$rotulo: ${_fmtData.format(data)}' : '$rotulo: —',
          style: const TextStyle(fontSize: 12.5),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final preco = _precoPrevisto;
    return AlertDialog(
      title: const Row(
        children: [
          Icon(Icons.event_note, color: AppTheme.primary),
          SizedBox(width: 10),
          Text('Agendar promoção'),
        ],
      ),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_produto == null) ...[
                TextField(
                  controller: _busca,
                  autofocus: true,
                  onChanged: _onBusca,
                  decoration: InputDecoration(
                    labelText: 'Produto (nome, código ou referência)',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: _buscando
                        ? const Padding(
                            padding: EdgeInsets.all(12),
                            child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                          )
                        : null,
                  ),
                ),
                for (final p in _resultados)
                  ListTile(
                    dense: true,
                    title: Text(p.descricao, maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text('Cód ${p.codigo.isNotEmpty ? p.codigo : p.id} • ${_money.format(p.precoVenda)}'),
                    onTap: () => setState(() {
                      _produto = p;
                      _resultados = [];
                    }),
                  ),
              ] else
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF7ED),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFFFDBA74)),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(_produto!.descricao, style: const TextStyle(fontWeight: FontWeight.bold)),
                            Text('Preço de venda: ${_money.format(_produto!.precoVenda)}',
                                style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                          ],
                        ),
                      ),
                      if (widget.produto == null)
                        IconButton(
                          tooltip: 'Trocar produto',
                          icon: const Icon(Icons.swap_horiz),
                          onPressed: () => setState(() => _produto = null),
                        ),
                    ],
                  ),
                ),
              const SizedBox(height: 14),
              TextField(
                controller: _desconto,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: 'Desconto (%)',
                  suffixText: preco != null ? '→ ${_money.format(preco)}' : '%',
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  _botaoData('Início', _inicio, inicio: true),
                  const SizedBox(width: 8),
                  _botaoData('Término', _fim, inicio: false),
                ],
              ),
              const SizedBox(height: 6),
              const Text(
                'Dica: início e término no mesmo dia = promoção de um dia só (ex.: a promoção da sexta).',
                style: TextStyle(fontSize: 11.5, color: AppTheme.textMuted),
              ),
              if (_erro != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: AppTheme.dangerBg, borderRadius: BorderRadius.circular(8)),
                  child: Text(_erro!, style: const TextStyle(color: AppTheme.dangerLight, fontSize: 12)),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _salvando ? null : () => Navigator.pop(context),
          child: const Text('Cancelar', style: TextStyle(color: AppTheme.textSecondary)),
        ),
        ElevatedButton.icon(
          onPressed: _salvando ? null : () => _salvar(),
          icon: _salvando
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.event_available, size: 18),
          label: Text(_salvando ? 'Salvando…' : 'Agendar'),
        ),
      ],
    );
  }
}
