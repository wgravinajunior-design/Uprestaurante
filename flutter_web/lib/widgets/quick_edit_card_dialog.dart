import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

class QuickEditCardDialog extends StatefulWidget {
  final Product product;
  final Function(Product updated) onUpdated;

  const QuickEditCardDialog({
    super.key,
    required this.product,
    required this.onUpdated,
  });

  @override
  State<QuickEditCardDialog> createState() => _QuickEditCardDialogState();
}

class _QuickEditCardDialogState extends State<QuickEditCardDialog> {
  late bool _statusAtivo;
  late TextEditingController _priceController;
  late TextEditingController _minPriceController;
  late TextEditingController _stockController;
  late TextEditingController _promoPriceController;
  late bool _emPromocao;
  DateTime? _startDate;
  DateTime? _endDate;
  bool _isLoading = false;
  String? _errorMessage;

  final currencyFormat = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
  final dateFormat = DateFormat('dd/MM/yyyy');

  @override
  void initState() {
    super.initState();
    final p = widget.product;
    _statusAtivo = p.isAtivo;
    _priceController = TextEditingController(text: p.precoVenda > 0 ? p.precoVenda.toStringAsFixed(2) : '');
    _minPriceController = TextEditingController(text: p.precoMinimo > 0 ? p.precoMinimo.toStringAsFixed(2) : '');
    // Nao arredonda: produtos fracionados (KG/L) manteriam o estoque alterado ao salvar
    _stockController = TextEditingController(text: _formatStock(p.estoque));
    _emPromocao = p.emPromocao;
    _promoPriceController = TextEditingController(text: p.precoPromocao > 0 ? p.precoPromocao.toStringAsFixed(2) : '');

    if (p.dtInicioProm != null) {
      try { _startDate = DateTime.parse(p.dtInicioProm!); } catch (_) {}
    }
    if (p.dtFimProm != null) {
      try { _endDate = DateTime.parse(p.dtFimProm!); } catch (_) {}
    }
  }

  static String _formatStock(double v) {
    if (v == v.truncateToDouble()) return v.toStringAsFixed(0);
    return v.toStringAsFixed(3).replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
  }

  @override
  void dispose() {
    _priceController.dispose();
    _minPriceController.dispose();
    _stockController.dispose();
    _promoPriceController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final newPrice = double.tryParse(_priceController.text.replaceAll(',', '.'));
    if (newPrice == null || newPrice < 0) {
      setState(() => _errorMessage = 'Informe um preço de venda válido.');
      return;
    }

    final newStock = double.tryParse(_stockController.text.replaceAll(',', '.'));
    if (newStock == null) {
      setState(() => _errorMessage = 'Informe uma quantidade de estoque válida.');
      return;
    }

    double? newPromoPrice;
    if (_emPromocao) {
      newPromoPrice = double.tryParse(_promoPriceController.text.replaceAll(',', '.'));
      if (newPromoPrice == null || newPromoPrice <= 0) {
        setState(() => _errorMessage = 'Informe o valor do preço promocional.');
        return;
      }
      if (newPromoPrice >= newPrice) {
        setState(() => _errorMessage = 'O preço promocional deve ser menor que o preço atual de venda.');
        return;
      }
      final now = DateTime.now();
      final today = DateTime(now.year, now.month, now.day);
      if (_endDate != null) {
        final end = DateTime(_endDate!.year, _endDate!.month, _endDate!.day);
        if (end.isBefore(today)) {
          setState(() => _errorMessage = 'A data de término da promoção já passou.');
          return;
        }
        if (_startDate != null && end.isBefore(DateTime(_startDate!.year, _startDate!.month, _startDate!.day))) {
          setState(() => _errorMessage = 'A data de término não pode ser anterior ao início.');
          return;
        }
      }
    }

    final newMinPrice = double.tryParse(_minPriceController.text.replaceAll(',', '.'));

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final updated = await ApiService.quickEditProduct(widget.product.id, {
        'status': _statusAtivo ? 'A' : 'I',
        'precoVenda': newPrice,
        ...?newMinPrice != null ? {'precoMinimo': newMinPrice} : null,
        'emPromocao': _emPromocao,
        if (_emPromocao && newPromoPrice != null) 'precoPromocao': newPromoPrice,
        if (_emPromocao && _startDate != null) 'dtInicioProm': _startDate!.toIso8601String().split('T')[0],
        if (_emPromocao && _endDate != null) 'dtFimProm': _endDate!.toIso8601String().split('T')[0],
        'estoque': newStock,
      });

      if (mounted) {
        widget.onUpdated(updated);
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.white),
                const SizedBox(width: 8),
                Text('Produto #${widget.product.id} atualizado no ERP com sucesso! (Origem: Upweb)'),
              ],
            ),
            backgroundColor: AppTheme.successLight,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString().replaceAll('Exception: ', '');
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.product;
    final currentStock = double.tryParse(_stockController.text.replaceAll(',', '.')) ?? p.estoque;
    final stockDiff = currentStock - p.estoque;

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      backgroundColor: Colors.white,
      insetPadding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(22),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Top Header with Product Info & Close
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Small thumbnail
                    Container(
                      width: 54,
                      height: 54,
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF8FAFC),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: AppTheme.borderLight),
                      ),
                      child: p.temFoto
                          ? Image.network(
                              ApiService.getProductImageUrl(p.id, p.ultimaAlteracao, 120),
                              fit: BoxFit.contain,
                              errorBuilder: (ctx, err, stack) => const Icon(Icons.broken_image, size: 24, color: AppTheme.textMuted),
                            )
                          : const Icon(Icons.inventory_2_outlined, size: 24, color: AppTheme.textMuted),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(
                                'Cód: ${p.codigo.isNotEmpty ? p.codigo : p.id}',
                                style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary, fontSize: 12),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: _statusAtivo ? AppTheme.successBg : AppTheme.dangerBg,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  _statusAtivo ? 'ATIVO' : 'INATIVO',
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                    color: _statusAtivo ? AppTheme.successLight : AppTheme.dangerLight,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 2),
                          Text(
                            p.descricao,
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: AppTheme.textPrimary),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: AppTheme.textSecondary, size: 20),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),

                const SizedBox(height: 16),
                const Divider(color: AppTheme.borderLight, height: 1),
                const SizedBox(height: 16),

                // Error alert
                if (_errorMessage != null) ...[
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppTheme.dangerBg,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFFFECACA)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline, color: AppTheme.dangerLight, size: 18),
                        const SizedBox(width: 8),
                        Expanded(child: Text(_errorMessage!, style: const TextStyle(color: AppTheme.dangerLight, fontSize: 12))),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                ],

                // 1. Status Toggle Row
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppTheme.borderLight),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          Icon(
                            _statusAtivo ? Icons.check_circle_outline : Icons.cancel_outlined,
                            color: _statusAtivo ? AppTheme.successLight : AppTheme.dangerLight,
                            size: 20,
                          ),
                          const SizedBox(width: 10),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Status', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.textPrimary)),
                              Text(
                                _statusAtivo ? 'Produto visível e liberado para venda' : 'Produto bloqueado/inativo no sistema',
                                style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                              ),
                            ],
                          ),
                        ],
                      ),
                      Switch(
                        value: _statusAtivo,
                        activeThumbColor: AppTheme.success,
                        inactiveThumbColor: AppTheme.danger,
                        activeTrackColor: const Color(0xFFA7F3D0),
                        inactiveTrackColor: const Color(0xFFFECACA),
                        onChanged: (val) => setState(() => _statusAtivo = val),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 16),

                // 2. Preço de Venda
                const Text(r'PREÇO DE VENDA (R$)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textSecondary, letterSpacing: 0.5)),
                const SizedBox(height: 6),
                TextField(
                  controller: _priceController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.attach_money, color: AppTheme.primary),
                    hintText: '0,00',
                    helperText: 'Preço atual gravado no ERP: ${currencyFormat.format(p.precoVenda)}',
                  ),
                ),

                const SizedBox(height: 16),

                // 3. Promoção Toggle & Inputs
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: _emPromocao ? const Color(0xFFFFF7ED) : const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: _emPromocao ? const Color(0xFFFDBA74) : AppTheme.borderLight,
                      width: _emPromocao ? 1.5 : 1,
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              Icon(Icons.local_fire_department, color: _emPromocao ? AppTheme.primary : AppTheme.textMuted, size: 20),
                              const SizedBox(width: 8),
                              Text(
                                'Colocar em Promoção',
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13,
                                  color: _emPromocao ? AppTheme.primary : AppTheme.textPrimary,
                                ),
                              ),
                            ],
                          ),
                          Switch(
                            value: _emPromocao,
                            activeThumbColor: AppTheme.primary,
                            activeTrackColor: const Color(0xFFFED7AA),
                            onChanged: (val) => setState(() => _emPromocao = val),
                          ),
                        ],
                      ),
                      if (_emPromocao) ...[
                        const SizedBox(height: 10),
                        // Quick percentage chips
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: [5, 10, 15, 20, 25, 30].map((pct) {
                            return InkWell(
                              onTap: () {
                                final basePrice = double.tryParse(_priceController.text.replaceAll(',', '.')) ?? p.precoVenda;
                                if (basePrice > 0) {
                                  final promoVal = basePrice * (1.0 - (pct / 100.0));
                                  setState(() {
                                    _promoPriceController.text = promoVal.toStringAsFixed(2);
                                  });
                                }
                              },
                              borderRadius: BorderRadius.circular(6),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(color: const Color(0xFFFDBA74)),
                                ),
                                child: Text(
                                  '-$pct%',
                                  style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w800,
                                    color: AppTheme.primary,
                                  ),
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _promoPriceController,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          onChanged: (_) => setState(() {}),
                          decoration: InputDecoration(
                            prefixIcon: const Icon(Icons.local_offer, color: AppTheme.primary),
                            hintText: r'Preço Promocional (R$)',
                            labelText: r'Preço Promocional (R$)',
                            fillColor: Colors.white,
                            suffixText: () {
                              final base = double.tryParse(_priceController.text.replaceAll(',', '.')) ?? p.precoVenda;
                              final promo = double.tryParse(_promoPriceController.text.replaceAll(',', '.'));
                              if (base > 0 && promo != null && promo < base) {
                                final discount = (((base - promo) / base) * 100).round();
                                return '-$discount% OFF';
                              }
                              return null;
                            }(),
                            suffixStyle: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: InkWell(
                                onTap: () async {
                                  final d = await showDatePicker(
                                    context: context,
                                    initialDate: _startDate ?? DateTime.now(),
                                    firstDate: DateTime(2020),
                                    lastDate: DateTime(2030),
                                    locale: const Locale('pt', 'BR'),
                                    helpText: 'Selecione a data de início',
                                    cancelText: 'Cancelar',
                                    confirmText: 'Confirmar',
                                  );
                                  if (d != null) setState(() => _startDate = d);
                                },
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(color: const Color(0xFFFDBA74)),
                                  ),
                                  child: Text(
                                    _startDate != null ? 'Início: ${dateFormat.format(_startDate!)}' : 'Início: Hoje',
                                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: InkWell(
                                onTap: () async {
                                  final d = await showDatePicker(
                                    context: context,
                                    initialDate: _endDate ?? DateTime.now().add(const Duration(days: 15)),
                                    firstDate: DateTime(2020),
                                    lastDate: DateTime(2030),
                                    locale: const Locale('pt', 'BR'),
                                    helpText: 'Selecione a data de término',
                                    cancelText: 'Cancelar',
                                    confirmText: 'Confirmar',
                                  );
                                  if (d != null) setState(() => _endDate = d);
                                },
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(color: const Color(0xFFFDBA74)),
                                  ),
                                  child: Text(
                                    _endDate != null ? 'Fim: ${dateFormat.format(_endDate!)}' : 'Fim: Indeterminado',
                                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),

                const SizedBox(height: 16),

                // 4. Estoque Atual & Movimentação
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('QUANTIDADE DE ESTOQUE', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textSecondary, letterSpacing: 0.5)),
                    if (stockDiff != 0)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: stockDiff > 0 ? AppTheme.successBg : AppTheme.dangerBg,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          stockDiff > 0 ? '+${stockDiff.toStringAsFixed(0)} (Entrada)' : '${stockDiff.toStringAsFixed(0)} (Saída)',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: stockDiff > 0 ? AppTheme.successLight : AppTheme.dangerLight,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: _stockController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.inventory_2, color: AppTheme.primary),
                    suffixText: p.unidade,
                    hintText: '0',
                    helperText: 'Estoque atual: ${_formatStock(p.estoque)} ${p.unidade}',
                  ),
                  onChanged: (_) => setState(() {}),
                ),

                const SizedBox(height: 24),

                // Bottom Actions: Cancel & Save
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _isLoading ? null : () => Navigator.pop(context),
                        child: const Text('Cancelar'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      flex: 2,
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.primary,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                        onPressed: _isLoading ? null : _save,
                        icon: _isLoading
                            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Icon(Icons.cloud_upload_outlined, size: 18),
                        label: Text(
                          _isLoading ? 'Gravando no ERP...' : 'Salvar Alterações',
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
