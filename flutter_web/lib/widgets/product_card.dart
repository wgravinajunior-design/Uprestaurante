import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'quick_edit_card_dialog.dart';

class ProductCard extends StatefulWidget {
  final Product product;
  final Function(Product) onUpdated;
  final VoidCallback onOpenDetails;

  /// Modo de seleção em lote: o toque no card marca/desmarca.
  final bool selectionMode;
  final bool selected;
  final VoidCallback? onToggleSelect;

  const ProductCard({
    super.key,
    required this.product,
    required this.onUpdated,
    required this.onOpenDetails,
    this.selectionMode = false,
    this.selected = false,
    this.onToggleSelect,
  });

  @override
  State<ProductCard> createState() => _ProductCardState();
}

class _ProductCardState extends State<ProductCard> {
  bool _isSwitchingStatus = false;
  bool _isHovered = false;

  Future<void> _toggleStatus(bool newValue) async {
    setState(() => _isSwitchingStatus = true);
    final targetStatus = newValue ? 'A' : 'I';

    // Guarda o original: apos o update otimista, widget.product ja e o novo valor
    final original = widget.product;

    // Optimistic UI update
    final updated = widget.product.copyWith(status: targetStatus);
    widget.onUpdated(updated);

    try {
      final res = await ApiService.updateStatus(widget.product.id, targetStatus);
      if (mounted) {
        widget.onUpdated(res);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              newValue
                  ? 'Produto #${widget.product.id} ATIVADO no ERP!'
                  : 'Produto #${widget.product.id} INATIVADO no ERP!',
            ),
            backgroundColor: newValue ? AppTheme.successLight : AppTheme.dangerLight,
            duration: const Duration(seconds: 2),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      // Rollback on error
      widget.onUpdated(original);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Erro ao atualizar status: ${e.toString().replaceAll('Exception: ', '')}'),
            backgroundColor: AppTheme.dangerLight,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSwitchingStatus = false);
    }
  }

  void _openQuickEdit(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => QuickEditCardDialog(
        product: widget.product,
        onUpdated: widget.onUpdated,
      ),
    );
  }

  void _showImageZoom(BuildContext context, String imageUrl) {
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.all(16),
        child: Stack(
          alignment: Alignment.topRight,
          children: [
            InteractiveViewer(
              panEnabled: true,
              boundaryMargin: const EdgeInsets.all(20),
              minScale: 0.8,
              maxScale: 4.0,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: Container(
                  color: Colors.white,
                  padding: const EdgeInsets.all(16),
                  child: Image.network(
                    imageUrl,
                    fit: BoxFit.contain,
                  ),
                ),
              ),
            ),
            IconButton(
              icon: const CircleAvatar(
                backgroundColor: Colors.black54,
                child: Icon(Icons.close, color: Colors.white),
              ),
              onPressed: () => Navigator.pop(ctx),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.product;
    final currencyFormat = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
    final imageUrl = ApiService.getProductImageUrl(p.id, p.ultimaAlteracao, 400);

    // Stock pill styling
    Color stockDotColor = AppTheme.success;
    Color stockBg = const Color(0xFFECFDF5);
    Color stockTextColor = const Color(0xFF065F46);
    String stockLabel = '${p.estoque.toStringAsFixed(0)} ${p.unidade} em estoque';

    if (p.estoque <= 0) {
      stockDotColor = AppTheme.danger;
      stockBg = const Color(0xFFFEF2F2);
      stockTextColor = const Color(0xFF991B1B);
      stockLabel = 'Sem estoque';
    } else if (p.estoque <= 5) {
      stockDotColor = AppTheme.warning;
      stockBg = const Color(0xFFFFFBEB);
      stockTextColor = const Color(0xFF92400E);
      stockLabel = 'Estoque baixo (${p.estoque.toStringAsFixed(0)} ${p.unidade})';
    }

    return MouseRegion(
      onEnter: (_) => setState(() => _isHovered = true),
      onExit: (_) => setState(() => _isHovered = false),
      child: GestureDetector(
        behavior: HitTestBehavior.deferToChild,
        onTap: widget.selectionMode ? widget.onToggleSelect : null,
        child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOutCubic,
        transform: Matrix4.translationValues(0, _isHovered ? -4 : 0, 0),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: widget.selected
                ? AppTheme.primary
                : (p.emPromocao
                    ? const Color(0xFFFDBA74)
                    : (_isHovered ? const Color(0xFFCBD5E1) : const Color(0xFFE2E8F0))),
            width: widget.selected ? 2.5 : (p.emPromocao ? 1.5 : 1),
          ),
          boxShadow: _isHovered ? AppTheme.modernCardHoverShadow : AppTheme.modernCardShadow,
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // --- 1. Product Image Area with Badges ---
              Stack(
                children: [
                  // Image container
                  AspectRatio(
                    aspectRatio: 1.28,
                    child: Container(
                      width: double.infinity,
                      decoration: const BoxDecoration(
                        gradient: AppTheme.cardImageBgGradient,
                      ),
                      padding: const EdgeInsets.all(8),
                      child: p.temFoto
                          ? Image.network(
                              imageUrl,
                              fit: BoxFit.contain,
                              errorBuilder: (ctx, err, stack) => _buildFallbackThumbnail(),
                            )
                          : _buildFallbackThumbnail(),
                    ),
                  ),

                  // Caixa de seleção (modo lote)
                  if (widget.selectionMode)
                    Positioned(
                      bottom: 6,
                      left: 6,
                      child: Container(
                        padding: const EdgeInsets.all(2),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.95),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: widget.selected ? AppTheme.primary : const Color(0xFFCBD5E1)),
                        ),
                        child: Icon(
                          widget.selected ? Icons.check_box : Icons.check_box_outline_blank,
                          size: 20,
                          color: widget.selected ? AppTheme.primary : AppTheme.textMuted,
                        ),
                      ),
                    ),

                  // Promotion Discount Badge (Top Left)
                  if (p.emPromocao)
                    Positioned(
                      top: 8,
                      left: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3.5),
                        decoration: BoxDecoration(
                          gradient: AppTheme.promoBadgeGradient,
                          borderRadius: BorderRadius.circular(8),
                          boxShadow: [
                            BoxShadow(
                              color: AppTheme.primary.withValues(alpha: 0.35),
                              blurRadius: 6,
                              offset: const Offset(0, 2),
                            ),
                          ],
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.local_fire_department, color: Colors.white, size: 12),
                            const SizedBox(width: 3),
                            Text(
                              p.descontoPercentual > 0
                                  ? '-${p.descontoPercentual}% OFF'
                                  : 'PROMOÇÃO',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 10,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 0.3,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                  // Status Pill & Switch (Top Right)
                  Positioned(
                    top: 8,
                    right: 8,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.96),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: p.isAtivo ? const Color(0xFFA7F3D0) : const Color(0xFFFECACA),
                          width: 1,
                        ),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x10000000),
                            blurRadius: 4,
                            offset: Offset(0, 1),
                          ),
                        ],
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 6,
                            height: 6,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: p.isAtivo ? AppTheme.success : AppTheme.danger,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            p.isAtivo ? 'ATIVO' : 'INATIVO',
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                              color: p.isAtivo ? AppTheme.successLight : AppTheme.dangerLight,
                              letterSpacing: 0.3,
                            ),
                          ),
                          const SizedBox(width: 2),
                          _isSwitchingStatus
                              ? const SizedBox(
                                  width: 12,
                                  height: 12,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primary),
                                )
                              : SizedBox(
                                  height: 18,
                                  width: 26,
                                  child: FittedBox(
                                    fit: BoxFit.fill,
                                    child: Switch(
                                      value: p.isAtivo,
                                      activeThumbColor: AppTheme.success,
                                      inactiveThumbColor: AppTheme.danger,
                                      activeTrackColor: const Color(0xFFA7F3D0),
                                      inactiveTrackColor: const Color(0xFFFECACA),
                                      onChanged: _toggleStatus,
                                    ),
                                  ),
                                ),
                        ],
                      ),
                    ),
                  ),

                  // Image Zoom Button (Bottom Right)
                  if (p.temFoto)
                    Positioned(
                      bottom: 6,
                      right: 6,
                      child: Tooltip(
                        message: 'Ampliar imagem',
                        child: InkWell(
                          onTap: () => _showImageZoom(context, ApiService.getProductImageUrl(p.id, p.ultimaAlteracao, 1200)),
                          borderRadius: BorderRadius.circular(6),
                          child: Container(
                            padding: const EdgeInsets.all(4),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.92),
                              borderRadius: BorderRadius.circular(6),
                              border: Border.all(color: const Color(0xFFE2E8F0)),
                              boxShadow: const [
                                BoxShadow(
                                  color: Color(0x0A000000),
                                  blurRadius: 3,
                                  offset: Offset(0, 1),
                                ),
                              ],
                            ),
                            child: const Icon(Icons.fullscreen_rounded, color: Color(0xFF475569), size: 15),
                          ),
                        ),
                      ),
                    ),
                ],
              ),

              // --- 2. Information & Stock Section ---
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Code & Reference Tag
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF1F5F9),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            'CÓD: ${p.codigo.isNotEmpty ? p.codigo : p.id}',
                            style: const TextStyle(
                              fontSize: 9.5,
                              color: Color(0xFF475569),
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.2,
                            ),
                          ),
                        ),
                        if (p.referencia.isNotEmpty) ...[
                          const SizedBox(width: 4),
                          Flexible(
                            child: Text(
                              'REF: ${p.referencia}',
                              style: const TextStyle(
                                fontSize: 9.5,
                                color: Color(0xFF64748B),
                                fontWeight: FontWeight.w600,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 5),

                    // Product Description / Title
                    Text(
                      p.descricao.toUpperCase(),
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF0F172A),
                        height: 1.2,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 6),

                    // Stock Pill with Indicator Dot
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2.5),
                      decoration: BoxDecoration(
                        color: stockBg,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 5,
                            height: 5,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: stockDotColor,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            stockLabel,
                            style: TextStyle(
                              fontSize: 9.5,
                              fontWeight: FontWeight.w700,
                              color: stockTextColor,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

              const Spacer(),

              // --- 3. Modern Price Card Block ---
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 2, 8, 4),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
                  decoration: BoxDecoration(
                    color: p.emPromocao ? const Color(0xFFFFF7ED) : const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: p.emPromocao ? const Color(0xFFFED7AA) : const Color(0xFFE2E8F0),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (p.emPromocao) ...[
                        // Strikethrough Regular Price
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'De:',
                              style: TextStyle(
                                fontSize: 9.5,
                                fontWeight: FontWeight.w500,
                                color: Color(0xFF94A3B8),
                              ),
                            ),
                            Text(
                              currencyFormat.format(p.precoVenda),
                              style: const TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w600,
                                color: Color(0xFF94A3B8),
                                decoration: TextDecoration.lineThrough,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 1),
                        // Highlighted Promo Price
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'Por:',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFFC2410C),
                              ),
                            ),
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(
                                currencyFormat.format(p.precoPromocao),
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w900,
                                  color: Color(0xFFEA580C),
                                  letterSpacing: -0.2,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ] else ...[
                        // Regular Price
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'PREÇO',
                              style: TextStyle(
                                fontSize: 9,
                                fontWeight: FontWeight.w700,
                                color: Color(0xFF64748B),
                                letterSpacing: 0.4,
                              ),
                            ),
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(
                                currencyFormat.format(p.precoVenda),
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w900,
                                  color: Color(0xFF0F172A),
                                  letterSpacing: -0.2,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ),

              // --- 4. Bottom Action Bar (Quick Edit & Details) ---
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                child: Row(
                  children: [
                    // Quick Edit Button
                    Expanded(
                      child: InkWell(
                        onTap: () => _openQuickEdit(context),
                        borderRadius: BorderRadius.circular(8),
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          decoration: BoxDecoration(
                            color: _isHovered ? AppTheme.primary : const Color(0xFFF1F5F9),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: _isHovered ? AppTheme.primary : const Color(0xFFE2E8F0),
                            ),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                Icons.tune_rounded,
                                size: 13,
                                color: _isHovered ? Colors.white : const Color(0xFF475569),
                              ),
                              const SizedBox(width: 4),
                              Text(
                                'Ajuste Rápido',
                                style: TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w800,
                                  color: _isHovered ? Colors.white : const Color(0xFF334155),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    // Details Modal Trigger
                    Tooltip(
                      message: 'Ver detalhes e vendas',
                      child: InkWell(
                        onTap: widget.onOpenDetails,
                        borderRadius: BorderRadius.circular(8),
                        child: Container(
                          padding: const EdgeInsets.all(6),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF1F5F9),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: const Color(0xFFE2E8F0)),
                          ),
                          child: const Icon(
                            Icons.visibility_outlined,
                            size: 14,
                            color: Color(0xFF64748B),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        ),
      ),
    );
  }

  Widget _buildFallbackThumbnail() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.inventory_2_outlined,
            color: AppTheme.textMuted.withValues(alpha: 0.6),
            size: 32,
          ),
          const SizedBox(height: 4),
          const Text(
            'Sem foto',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w500,
              color: AppTheme.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}
