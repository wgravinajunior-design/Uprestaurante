import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../theme/app_theme.dart';

/// Pede o percentual (e, para promoção, as datas) de uma ação em lote.
/// Retorna { percentual: double, dtInicio?: 'yyyy-MM-dd', dtFim?: 'yyyy-MM-dd' } ou null se cancelado.
Future<Map<String, dynamic>?> showBatchPercentDialog(
  BuildContext context, {
  required bool promo,
  required int count,
}) {
  return showDialog<Map<String, dynamic>>(
    context: context,
    builder: (ctx) => _BatchPercentDialog(promo: promo, count: count),
  );
}

class _BatchPercentDialog extends StatefulWidget {
  final bool promo;
  final int count;

  const _BatchPercentDialog({required this.promo, required this.count});

  @override
  State<_BatchPercentDialog> createState() => _BatchPercentDialogState();
}

class _BatchPercentDialogState extends State<_BatchPercentDialog> {
  late final TextEditingController _pctController;
  DateTime? _start;
  DateTime? _end;
  String? _error;
  final _dateFormat = DateFormat('dd/MM/yyyy');
  final _isoFormat = DateFormat('yyyy-MM-dd');

  @override
  void initState() {
    super.initState();
    _pctController = TextEditingController(text: widget.promo ? '10' : '5');
  }

  @override
  void dispose() {
    _pctController.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool isStart}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (isStart ? _start : _end) ?? (isStart ? now : now.add(const Duration(days: 15))),
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
      locale: const Locale('pt', 'BR'),
      helpText: isStart ? 'Selecione a data de início' : 'Selecione a data de término',
      cancelText: 'Cancelar',
      confirmText: 'Confirmar',
    );
    if (picked != null) {
      setState(() => isStart ? _start = picked : _end = picked);
    }
  }

  void _submit() {
    final pct = double.tryParse(_pctController.text.trim().replaceAll(',', '.'));
    if (pct == null) {
      setState(() => _error = 'Informe um percentual válido.');
      return;
    }
    if (widget.promo) {
      if (pct < 1 || pct > 90) {
        setState(() => _error = 'O desconto deve estar entre 1% e 90%.');
        return;
      }
      final now = DateTime.now();
      final today = DateTime(now.year, now.month, now.day);
      if (_end != null) {
        final end = DateTime(_end!.year, _end!.month, _end!.day);
        if (end.isBefore(today)) {
          setState(() => _error = 'A data de término já passou.');
          return;
        }
        if (_start != null && end.isBefore(DateTime(_start!.year, _start!.month, _start!.day))) {
          setState(() => _error = 'A data de término não pode ser anterior ao início.');
          return;
        }
      }
    } else if (pct == 0 || pct < -90 || pct > 200) {
      setState(() => _error = 'Use um valor entre -90 e 200 (diferente de 0). Negativo reduz o preço.');
      return;
    }

    Navigator.pop(context, {
      'percentual': pct,
      if (widget.promo && _start != null) 'dtInicio': _isoFormat.format(_start!),
      if (widget.promo && _end != null) 'dtFim': _isoFormat.format(_end!),
    });
  }

  Widget _dateButton({required bool isStart}) {
    final date = isStart ? _start : _end;
    final label = isStart ? 'Início' : 'Término';
    return Expanded(
      child: OutlinedButton.icon(
        onPressed: () => _pickDate(isStart: isStart),
        icon: Icon(isStart ? Icons.calendar_today : Icons.event, size: 16),
        label: Text(
          date != null ? '$label: ${_dateFormat.format(date)}' : (isStart ? 'Início: hoje' : 'Término: sem data'),
          style: const TextStyle(fontSize: 12),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Row(
        children: [
          Icon(widget.promo ? Icons.local_fire_department : Icons.price_change, color: AppTheme.primary),
          const SizedBox(width: 10),
          Text(widget.promo ? 'Promoção em lote' : 'Reajuste de preço em lote'),
        ],
      ),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Será aplicado a ${widget.count} produto(s) selecionado(s).',
              style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _pctController,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
              decoration: InputDecoration(
                labelText: widget.promo ? 'Desconto (%)' : 'Reajuste (%)',
                suffixText: '%',
                helperText: widget.promo
                    ? 'Preço promocional = preço de venda − desconto'
                    : 'Positivo aumenta, negativo reduz (ex.: 10 ou -5)',
              ),
              onSubmitted: (_) => _submit(),
            ),
            if (widget.promo) ...[
              const SizedBox(height: 14),
              Row(
                children: [
                  _dateButton(isStart: true),
                  const SizedBox(width: 8),
                  _dateButton(isStart: false),
                ],
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.dangerBg,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(_error!, style: const TextStyle(color: AppTheme.dangerLight, fontSize: 12)),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar', style: TextStyle(color: AppTheme.textSecondary)),
        ),
        ElevatedButton(onPressed: _submit, child: const Text('Continuar')),
      ],
    );
  }
}

/// Mostra o resumo de uma operação em lote (quantos deram certo e os erros).
Future<void> showBatchResultDialog(BuildContext context, Map<String, dynamic> result) {
  final total = (result['total'] as num?)?.toInt() ?? 0;
  final ok = (result['ok'] as num?)?.toInt() ?? 0;
  final falhas = (result['falhas'] as num?)?.toInt() ?? 0;
  final List resultados = result['resultados'] as List? ?? [];
  final erros = resultados.where((r) => r is Map && r['ok'] != true).cast<Map>().toList();

  return showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Row(
        children: [
          Icon(
            falhas == 0 ? Icons.check_circle : Icons.warning_amber_rounded,
            color: falhas == 0 ? AppTheme.successLight : AppTheme.warningLight,
          ),
          const SizedBox(width: 10),
          const Text('Resultado da operação'),
        ],
      ),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '$ok de $total produto(s) alterado(s) com sucesso.',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
            ),
            if (falhas > 0) ...[
              const SizedBox(height: 10),
              Text('$falhas com erro (continuam selecionados):', style: const TextStyle(color: AppTheme.dangerLight)),
              const SizedBox(height: 6),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 220),
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final e in erros.take(50))
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Text(
                          '#${e['id']}: ${e['erro'] ?? 'erro desconhecido'}',
                          style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        ElevatedButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK')),
      ],
    ),
  );
}
