import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'quick_price_dialog.dart';
import 'quick_promo_dialog.dart';

class ProductTableView extends StatelessWidget {
  final List<Product> products;
  final Function(Product updated) onUpdated;
  final Function(Product product) onOpenDetails;

  /// Seleção em lote (caixas de seleção na primeira coluna).
  final bool selectionMode;
  final Set<int> selectedIds;
  final void Function(int id)? onToggleSelect;

  const ProductTableView({
    super.key,
    required this.products,
    required this.onUpdated,
    required this.onOpenDetails,
    this.selectionMode = false,
    this.selectedIds = const {},
    this.onToggleSelect,
  });

  @override
  Widget build(BuildContext context) {
    final currencyFormat = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.borderLight),
        boxShadow: const [
          BoxShadow(
            color: Color(0x08000000),
            blurRadius: 10,
            offset: Offset(0, 3),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            showCheckboxColumn: selectionMode,
            columnSpacing: 20,
            horizontalMargin: 20,
            headingRowHeight: 52,
            dataRowMinHeight: 64,
            dataRowMaxHeight: 68,
            headingRowColor: WidgetStateProperty.all(const Color(0xFFF8FAFC)),
            columns: const [
              DataColumn(label: Text('FOTO', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textSecondary))),
              DataColumn(label: Text('CÓDIGO', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textSecondary))),
              DataColumn(label: Text('DESCRIÇÃO', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textSecondary))),
              DataColumn(label: Text('STATUS', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textSecondary))),
              DataColumn(label: Text('ESTOQUE', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textSecondary))),
              DataColumn(label: Text('PREÇO VENDA', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textSecondary))),
              DataColumn(label: Text('PROMOÇÃO', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textSecondary))),
              DataColumn(label: Text('AÇÕES', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.textSecondary))),
            ],
            rows: products.map((p) {
              Color stockTextColor = AppTheme.successLight;
              Color stockBgColor = AppTheme.successBg;

              if (p.estoque <= 0) {
                stockTextColor = AppTheme.dangerLight;
                stockBgColor = AppTheme.dangerBg;
              } else if (p.estoque <= 5) {
                stockTextColor = AppTheme.warningLight;
                stockBgColor = AppTheme.warningBg;
              }

              return DataRow(
                selected: selectionMode && selectedIds.contains(p.id),
                onSelectChanged: selectionMode ? (_) => onToggleSelect?.call(p.id) : null,
                cells: [
                  // Photo
                  DataCell(
                    Container(
                      width: 48,
                      height: 48,
                      padding: const EdgeInsets.all(3),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF8FAFC),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppTheme.borderLight),
                      ),
                      child: p.temFoto
                          ? Image.network(
                              ApiService.getProductImageUrl(p.id, p.ultimaAlteracao, 120),
                              fit: BoxFit.contain,
                              errorBuilder: (ctx, err, stack) => const Icon(Icons.broken_image, size: 20, color: AppTheme.textMuted),
                            )
                          : const Icon(Icons.inventory_2_outlined, size: 20, color: AppTheme.textMuted),
                    ),
                  ),

                  // Code
                  DataCell(
                    Text(
                      p.codigo.isNotEmpty ? p.codigo : p.id.toString(),
                      style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary),
                    ),
                  ),

                  // Description
                  DataCell(
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 240),
                      child: Text(
                        p.descricao,
                        style: const TextStyle(fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),

                  // Status with Switch
                  DataCell(
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: p.isAtivo ? AppTheme.success : AppTheme.danger,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          p.isAtivo ? 'Ativo' : 'Inativo',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: p.isAtivo ? AppTheme.successLight : AppTheme.dangerLight,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Switch(
                          value: p.isAtivo,
                          activeThumbColor: AppTheme.success,
                          inactiveThumbColor: AppTheme.danger,
                          activeTrackColor: const Color(0xFFA7F3D0),
                          inactiveTrackColor: const Color(0xFFFECACA),
                          onChanged: (val) async {
                            final messenger = ScaffoldMessenger.of(context);
                            try {
                              final updated = await ApiService.updateStatus(p.id, val ? 'A' : 'I');
                              onUpdated(updated);
                            } catch (e) {
                              messenger.showSnackBar(
                                SnackBar(
                                  backgroundColor: AppTheme.dangerLight,
                                  content: Text('Erro ao atualizar status: ${e.toString().replaceAll('Exception: ', '')}'),
                                ),
                              );
                            }
                          },
                        ),
                      ],
                    ),
                  ),

                  // Stock
                  DataCell(
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: stockBgColor,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '${p.estoque.toStringAsFixed(0)} ${p.unidade}',
                        style: TextStyle(color: stockTextColor, fontWeight: FontWeight.bold, fontSize: 12),
                      ),
                    ),
                  ),

                  // Preço Venda
                  DataCell(
                    Text(
                      currencyFormat.format(p.precoVenda),
                      style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary, fontSize: 14),
                    ),
                  ),

                  // Promoção
                  DataCell(
                    p.emPromocao
                        ? Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFFF7ED),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: const Color(0xFFFDBA74)),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.local_fire_department, size: 14, color: AppTheme.primary),
                                const SizedBox(width: 4),
                                Text(
                                  currencyFormat.format(p.precoPromocao),
                                  style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary, fontSize: 13),
                                ),
                              ],
                            ),
                          )
                        : const Text('-', style: TextStyle(color: AppTheme.textMuted)),
                  ),

                  // Actions
                  DataCell(
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          tooltip: 'Alterar Preço',
                          icon: const Icon(Icons.attach_money, color: AppTheme.primary, size: 20),
                          onPressed: () {
                            showDialog(
                              context: context,
                              builder: (ctx) => QuickPriceDialog(product: p, onUpdated: onUpdated),
                            );
                          },
                        ),
                        IconButton(
                          tooltip: 'Configurar Promoção',
                          icon: Icon(Icons.local_offer, color: p.emPromocao ? AppTheme.primary : AppTheme.textSecondary, size: 20),
                          onPressed: () {
                            showDialog(
                              context: context,
                              builder: (ctx) => QuickPromoDialog(product: p, onUpdated: onUpdated),
                            );
                          },
                        ),
                        IconButton(
                          tooltip: 'Editar / Detalhes / Vendas',
                          icon: const Icon(Icons.edit_note, color: AppTheme.textPrimary, size: 22),
                          onPressed: () => onOpenDetails(p),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            }).toList(),
          ),
        ),
      ),
    );
  }
}
