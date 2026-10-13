import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

class QuickPriceDialog extends StatefulWidget {
  final Product product;
  final Function(Product updated) onUpdated;

  const QuickPriceDialog({
    super.key,
    required this.product,
    required this.onUpdated,
  });

  @override
  State<QuickPriceDialog> createState() => _QuickPriceDialogState();
}

class _QuickPriceDialogState extends State<QuickPriceDialog> {
  late TextEditingController _priceController;
  late TextEditingController _minPriceController;
  bool _isLoading = false;
  String? _errorMessage;
  final currencyFormat = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

  @override
  void initState() {
    super.initState();
    _priceController = TextEditingController(text: widget.product.precoVenda.toStringAsFixed(2));
    _minPriceController = TextEditingController(text: widget.product.precoMinimo.toStringAsFixed(2));
  }

  @override
  void dispose() {
    _priceController.dispose();
    _minPriceController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final newPrice = double.tryParse(_priceController.text.replaceAll(',', '.'));
    if (newPrice == null || newPrice < 0) {
      setState(() => _errorMessage = 'Informe um preço de venda válido');
      return;
    }

    final newMinPrice = double.tryParse(_minPriceController.text.replaceAll(',', '.'));

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final updated = await ApiService.updatePrice(widget.product.id, newPrice, newMinPrice);
      if (mounted) {
        widget.onUpdated(updated);
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppTheme.success,
            behavior: SnackBarBehavior.floating,
            content: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.white),
                const SizedBox(width: 10),
                Text('Preço do produto #${widget.product.codigo} atualizado no ERP!'),
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
        width: 440,
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
                        color: AppTheme.primary.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.price_change, color: AppTheme.primary, size: 22),
                    ),
                    const SizedBox(width: 12),
                    const Text(
                      'Alterar Preço de Venda',
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
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '#${widget.product.codigo} - ${widget.product.descricao}',
                    style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary, fontSize: 13),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Preço Atual: ${currencyFormat.format(widget.product.precoVenda)}  •  Estoque: ${widget.product.estoque.toStringAsFixed(0)} ${widget.product.unidade}',
                    style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _priceController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Novo Preço de Venda (R\$)',
                prefixText: 'R\$ ',
                prefixStyle: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold, fontSize: 18),
                helperText: 'Atualiza o preço de venda do produto',
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _minPriceController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'Preço Mínimo / Flex (R\$)',
                prefixText: 'R\$ ',
              ),
            ),
            if (_errorMessage != null) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.dangerBg,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.danger.withValues(alpha: 0.5)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: AppTheme.danger, size: 18),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _errorMessage!,
                        style: const TextStyle(color: AppTheme.danger, fontSize: 12),
                      ),
                    ),
                  ],
                ),
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
                  onPressed: _isLoading ? null : _save,
                  icon: _isLoading
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.save, size: 18),
                  label: Text(_isLoading ? 'Salvando no ERP...' : 'Salvar no ERP'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
