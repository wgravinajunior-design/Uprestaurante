import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

class QuickPromoDialog extends StatefulWidget {
  final Product product;
  final Function(Product updated) onUpdated;

  const QuickPromoDialog({
    super.key,
    required this.product,
    required this.onUpdated,
  });

  @override
  State<QuickPromoDialog> createState() => _QuickPromoDialogState();
}

class _QuickPromoDialogState extends State<QuickPromoDialog> {
  late bool _ativo;
  late TextEditingController _promoPriceController;
  late TextEditingController _percentController;
  DateTime? _startDate;
  DateTime? _endDate;
  bool _isLoading = false;
  String? _errorMessage;
  final currencyFormat = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
  final dateFormat = DateFormat('dd/MM/yyyy');

  @override
  void initState() {
    super.initState();
    _ativo = widget.product.emPromocao;
    final promoVal = widget.product.precoPromocao > 0
        ? widget.product.precoPromocao
        : (widget.product.precoVenda > 0 ? widget.product.precoVenda * 0.85 : 0.0);
    _promoPriceController = TextEditingController(text: promoVal.toStringAsFixed(2));

    final perc = widget.product.precoVenda > 0 && widget.product.precoPromocao > 0
        ? (((widget.product.precoVenda - widget.product.precoPromocao) / widget.product.precoVenda) * 100).round()
        : 15;
    _percentController = TextEditingController(text: perc.toString());

    if (widget.product.dtInicioProm != null) {
      try {
        _startDate = DateTime.parse(widget.product.dtInicioProm!);
      } catch (_) {
        _startDate = DateTime.now();
      }
    } else {
      _startDate = DateTime.now();
    }

    if (widget.product.dtFimProm != null) {
      try {
        _endDate = DateTime.parse(widget.product.dtFimProm!);
      } catch (_) {
        _endDate = DateTime.now().add(const Duration(days: 15));
      }
    } else {
      _endDate = DateTime.now().add(const Duration(days: 15));
    }
  }

  @override
  void dispose() {
    _promoPriceController.dispose();
    _percentController.dispose();
    super.dispose();
  }

  void _onPriceChanged(String val) {
    final promoPrice = double.tryParse(val.replaceAll(',', '.'));
    if (promoPrice != null && widget.product.precoVenda > 0) {
      final perc = ((widget.product.precoVenda - promoPrice) / widget.product.precoVenda) * 100;
      _percentController.text = perc.toStringAsFixed(0);
    }
    setState(() {});
  }

  void _onPercentChanged(String val) {
    final perc = double.tryParse(val.replaceAll(',', '.'));
    if (perc != null && widget.product.precoVenda > 0) {
      final promoPrice = widget.product.precoVenda * (1 - (perc / 100));
      _promoPriceController.text = promoPrice.toStringAsFixed(2);
    }
    setState(() {});
  }

  void _validatePromoDates() {
    final today = DateTime.now();
    final todayDate = DateTime(today.year, today.month, today.day);
    if (_endDate != null) {
      final end = DateTime(_endDate!.year, _endDate!.month, _endDate!.day);
      if (end.isBefore(todayDate)) {
        throw Exception('A data de término da promoção já passou');
      }
      if (_startDate != null && end.isBefore(DateTime(_startDate!.year, _startDate!.month, _startDate!.day))) {
        throw Exception('A data de término não pode ser anterior ao início');
      }
    }
  }

  Future<void> _save() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      double? promoPrice;
      if (_ativo) {
        promoPrice = double.tryParse(_promoPriceController.text.replaceAll(',', '.'));
        if (promoPrice == null || promoPrice <= 0) {
          throw Exception('Informe um preço promocional válido');
        }
        if (widget.product.precoVenda > 0 && promoPrice >= widget.product.precoVenda) {
          throw Exception('O preço promocional deve ser menor que o preço de venda');
        }
        _validatePromoDates();
      }

      final dIniStr = _startDate != null ? DateFormat('yyyy-MM-dd').format(_startDate!) : null;
      final dFimStr = _endDate != null ? DateFormat('yyyy-MM-dd').format(_endDate!) : null;

      final updated = await ApiService.updatePromotion(
        widget.product.id,
        ativo: _ativo,
        valorPromocional: promoPrice,
        dtInicio: dIniStr,
        dtFim: dFimStr,
      );

      if (mounted) {
        widget.onUpdated(updated);
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: _ativo ? AppTheme.warning : AppTheme.primary,
            behavior: SnackBarBehavior.floating,
            content: Row(
              children: [
                Icon(_ativo ? Icons.local_fire_department : Icons.info_outline, color: Colors.white),
                const SizedBox(width: 10),
                Text(_ativo
                    ? 'Produto #${widget.product.codigo} colocado em promoção com sucesso!'
                    : 'Promoção removida do produto #${widget.product.codigo}!'),
              ],
            ),
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _errorMessage = e.toString().replaceAll('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      child: Container(
        width: 500,
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppTheme.warning.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.local_offer, color: AppTheme.warning, size: 22),
                    ),
                    const SizedBox(width: 12),
                    const Text(
                      'Gestão de Promoção',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                    ),
                  ],
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: AppTheme.textSecondary),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppTheme.borderLight),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '#${widget.product.codigo} - ${widget.product.descricao}',
                          style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary, fontSize: 13),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Preço Normal: ${currencyFormat.format(widget.product.precoVenda)}',
                          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  Switch(
                    value: _ativo,
                    activeThumbColor: AppTheme.warning,
                    onChanged: (val) => setState(() => _ativo = val),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            if (_ativo) ...[
              Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: TextField(
                      controller: _promoPriceController,
                      onChanged: _onPriceChanged,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.warning),
                      decoration: const InputDecoration(
                        labelText: 'Preço Promocional (R\$)',
                        prefixText: 'R\$ ',
                        prefixStyle: TextStyle(color: AppTheme.warning, fontWeight: FontWeight.bold, fontSize: 18),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: TextField(
                      controller: _percentController,
                      onChanged: _onPercentChanged,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Desconto %',
                        suffixText: '%',
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: InkWell(
                      onTap: () async {
                        final picked = await showDatePicker(
                          context: context,
                          initialDate: _startDate ?? DateTime.now(),
                          firstDate: DateTime(2020),
                          lastDate: DateTime(2030),
                          locale: const Locale('pt', 'BR'),
                          helpText: 'Selecione a data de início',
                          cancelText: 'Cancelar',
                          confirmText: 'Confirmar',
                        );
                        if (picked != null) setState(() => _startDate = picked);
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppTheme.borderLight),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.calendar_today, size: 16, color: AppTheme.textSecondary),
                            const SizedBox(width: 8),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Início Promoção', style: TextStyle(fontSize: 10, color: AppTheme.textMuted)),
                                Text(
                                  _startDate != null ? dateFormat.format(_startDate!) : 'Hoje',
                                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: InkWell(
                      onTap: () async {
                        final picked = await showDatePicker(
                          context: context,
                          initialDate: _endDate ?? DateTime.now().add(const Duration(days: 15)),
                          firstDate: DateTime(2020),
                          lastDate: DateTime(2030),
                          locale: const Locale('pt', 'BR'),
                          helpText: 'Selecione a data de término',
                          cancelText: 'Cancelar',
                          confirmText: 'Confirmar',
                        );
                        if (picked != null) setState(() => _endDate = picked);
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppTheme.borderLight),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.event, size: 16, color: AppTheme.textSecondary),
                            const SizedBox(width: 8),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Término Promoção', style: TextStyle(fontSize: 10, color: AppTheme.textMuted)),
                                Text(
                                  _endDate != null ? dateFormat.format(_endDate!) : 'Indeterminado',
                                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ] else ...[
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceLighter.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline, color: AppTheme.textSecondary),
                    SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'A promoção para este produto está desativada. O valor cobrado será o preço normal de venda.',
                        style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (_errorMessage != null) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.dangerBg,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.danger.withValues(alpha: 0.5)),
                ),
                child: Text(_errorMessage!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
              ),
            ],
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: _isLoading ? null : () => Navigator.pop(context),
                  child: const Text('Cancelar', style: TextStyle(color: AppTheme.textSecondary)),
                ),
                const SizedBox(width: 12),
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _ativo ? AppTheme.warning : AppTheme.primary,
                  ),
                  onPressed: _isLoading ? null : _save,
                  icon: _isLoading
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.check, size: 18),
                  label: Text(_isLoading ? 'Gravando no ERP...' : (_ativo ? 'Ativar Promoção' : 'Remover Promoção')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
