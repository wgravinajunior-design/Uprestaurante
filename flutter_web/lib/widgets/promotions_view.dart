import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/promotion_item.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'batch_dialogs.dart';
import 'product_edit_dialog.dart';

/// Visão das promoções: ativas, expirando, futuras e vencidas, com ação de encerrar.
class PromotionsView extends StatefulWidget {
  /// Chamado sempre que as contagens mudam (para o selo do menu lateral).
  final ValueChanged<PromotionCounts>? onChanged;

  const PromotionsView({super.key, this.onChanged});

  @override
  State<PromotionsView> createState() => _PromotionsViewState();
}

class _PromotionsViewState extends State<PromotionsView> {
  PromotionsData? _data;
  bool _loading = true;
  String? _error;
  String _filtro = 'TODAS'; // TODAS | ATIVAS | EXPIRANDO | FUTURAS | VENCIDAS
  bool _busy = false;

  final _money = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
  final _dateFmt = DateFormat('dd/MM/yyyy');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await ApiService.getPromotions();
      if (!mounted) return;
      setState(() {
        _data = data;
        _loading = false;
      });
      widget.onChanged?.call(data.contagem);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString().replaceAll('Exception: ', '');
        _loading = false;
      });
    }
  }

  List<PromotionItem> get _filtrados {
    final itens = _data?.itens ?? const <PromotionItem>[];
    switch (_filtro) {
      case 'ATIVAS':
        return itens.where((p) => p.isAtiva).toList();
      case 'EXPIRANDO':
        return itens.where((p) => p.expirando).toList();
      case 'FUTURAS':
        return itens.where((p) => p.isFutura).toList();
      case 'VENCIDAS':
        return itens.where((p) => p.isVencida).toList();
      default:
        return itens;
    }
  }

  String _fmtDate(String? ymd) {
    if (ymd == null || ymd.isEmpty) return '—';
    try {
      return _dateFmt.format(DateTime.parse(ymd));
    } catch (_) {
      return ymd;
    }
  }

  String _prazo(PromotionItem p) {
    String dias(int n) => n == 1 ? '1 dia' : '$n dias';
    if (p.isVencida) {
      final n = -(p.diasParaFim ?? 0);
      return 'Venceu há ${dias(n)}';
    }
    if (p.isFutura) {
      return 'Começa em ${dias(p.diasParaInicio ?? 0)}';
    }
    final fim = p.diasParaFim;
    if (fim == null) return 'Sem data de término';
    if (fim == 0) return 'Termina hoje';
    if (fim == 1) return 'Termina amanhã';
    return 'Termina em ${dias(fim)}';
  }

  Future<bool> _confirmar(String titulo, String texto, String botao) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(titulo),
        content: Text(texto),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: Text(botao)),
        ],
      ),
    );
    return ok == true;
  }

  Future<void> _encerrar(List<PromotionItem> itens, {required String titulo}) async {
    if (itens.isEmpty || _busy) return;
    final ok = await _confirmar(
      titulo,
      itens.length == 1
          ? 'Remover a promoção de "${itens.first.descricao}"? O produto volta ao preço normal.'
          : 'Remover a promoção de ${itens.length} produto(s)? Eles voltam ao preço normal.',
      'Remover',
    );
    if (!ok || !mounted) return;

    setState(() => _busy = true);
    try {
      final result = await ApiService.batchUpdate(
        ids: itens.map((e) => e.id).toList(),
        acao: 'PROMOCAO_REMOVER',
      );
      if (!mounted) return;
      if ((result['falhas'] as num?)?.toInt() != 0) {
        await showBatchResultDialog(context, result);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: AppTheme.successLight,
            behavior: SnackBarBehavior.floating,
            content: Text('${result['ok']} promoção(ões) removida(s).'),
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppTheme.dangerLight,
          content: Text(e.toString().replaceAll('Exception: ', '')),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    await _load();
  }

  Future<void> _editar(PromotionItem p) async {
    try {
      final product = await ApiService.getProduct(p.id);
      if (!mounted) return;
      await showDialog(
        context: context,
        builder: (ctx) => ProductEditDialog(product: product, onUpdated: (_) {}),
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppTheme.dangerLight,
          content: Text(e.toString().replaceAll('Exception: ', '')),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isMobile = MediaQuery.of(context).size.width < 900;
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: isMobile ? 12 : 24, vertical: isMobile ? 12 : 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildHeader(),
          const SizedBox(height: 12),
          if (_data != null) _buildAvisos(_data!.contagem),
          if (_data != null) _buildFiltros(_data!.contagem),
          const SizedBox(height: 12),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    final vencidas = _data?.itens.where((p) => p.isVencida).toList() ?? const <PromotionItem>[];
    return Wrap(
      alignment: WrapAlignment.spaceBetween,
      crossAxisAlignment: WrapCrossAlignment.center,
      runSpacing: 8,
      children: [
        const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.local_offer, color: AppTheme.primary, size: 24),
            SizedBox(width: 10),
            Text(
              'Promoções',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
            ),
          ],
        ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (vencidas.isNotEmpty)
              OutlinedButton.icon(
                onPressed: _busy ? null : () => _encerrar(vencidas, titulo: 'Limpar promoções vencidas'),
                icon: const Icon(Icons.cleaning_services_outlined, size: 18),
                label: Text('Limpar vencidas (${vencidas.length})'),
              ),
            const SizedBox(width: 8),
            IconButton(
              tooltip: 'Atualizar',
              icon: const Icon(Icons.refresh, color: AppTheme.textSecondary),
              onPressed: _loading ? null : _load,
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildAvisos(PromotionCounts c) {
    final avisos = <Widget>[];
    if (c.expirando > 0) {
      avisos.add(_aviso(
        Icons.hourglass_bottom,
        '${c.expirando} promoção(ões) termina(m) em até ${_data!.diasAlerta} dia(s).',
        AppTheme.warningBg,
        AppTheme.warningLight,
      ));
    }
    if (c.vencidas > 0) {
      avisos.add(_aviso(
        Icons.event_busy,
        '${c.vencidas} promoção(ões) vencida(s) ainda gravada(s) no cadastro — não valem mais, mas ocupam o produto.',
        AppTheme.dangerBg,
        AppTheme.dangerLight,
      ));
    }
    if (avisos.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(children: avisos),
    );
  }

  Widget _aviso(IconData icon, String texto, Color bg, Color fg) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
      child: Row(
        children: [
          Icon(icon, color: fg, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text(texto, style: TextStyle(color: fg, fontSize: 12.5, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }

  Widget _buildFiltros(PromotionCounts c) {
    Widget chip(String valor, String rotulo, int n) {
      final sel = _filtro == valor;
      return ChoiceChip(
        label: Text('$rotulo ($n)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: sel ? Colors.white : AppTheme.textPrimary)),
        selected: sel,
        selectedColor: AppTheme.primary,
        backgroundColor: AppTheme.surfaceWhite,
        showCheckmark: false,
        onSelected: (_) => setState(() => _filtro = valor),
      );
    }

    return Wrap(
      spacing: 8,
      runSpacing: 6,
      children: [
        chip('TODAS', 'Todas', c.todas),
        chip('ATIVAS', 'Ativas', c.ativas),
        chip('EXPIRANDO', 'Expirando', c.expirando),
        chip('FUTURAS', 'Futuras', c.futuras),
        chip('VENCIDAS', 'Vencidas', c.vencidas),
      ],
    );
  }

  Widget _buildBody() {
    if (_loading && _data == null) {
      return const Center(child: CircularProgressIndicator(color: AppTheme.primary));
    }
    if (_error != null && _data == null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off, size: 44, color: AppTheme.dangerLight),
            const SizedBox(height: 12),
            Text('Erro ao carregar promoções: $_error', style: const TextStyle(color: AppTheme.dangerLight)),
            const SizedBox(height: 14),
            ElevatedButton(onPressed: _load, child: const Text('Tentar novamente')),
          ],
        ),
      );
    }

    final itens = _filtrados;
    if (itens.isEmpty) {
      return const Center(
        child: Text('Nenhuma promoção nesta categoria.', style: TextStyle(color: AppTheme.textSecondary)),
      );
    }

    return ListView.separated(
      itemCount: itens.length,
      separatorBuilder: (ctx, i) => const SizedBox(height: 8),
      itemBuilder: (ctx, i) => _buildLinha(itens[i]),
    );
  }

  Widget _buildLinha(PromotionItem p) {
    Color corSituacao;
    String rotulo;
    if (p.isVencida) {
      corSituacao = AppTheme.dangerLight;
      rotulo = 'VENCIDA';
    } else if (p.isFutura) {
      corSituacao = const Color(0xFF2563EB);
      rotulo = 'FUTURA';
    } else if (p.expirando) {
      corSituacao = AppTheme.warningLight;
      rotulo = 'EXPIRANDO';
    } else {
      corSituacao = AppTheme.successLight;
      rotulo = 'ATIVA';
    }

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: p.isVencida ? const Color(0xFFFECACA) : AppTheme.borderLight),
      ),
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
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
                    errorBuilder: (ctx, err, stack) => const Icon(Icons.broken_image, color: AppTheme.textMuted),
                  )
                : const Icon(Icons.inventory_2_outlined, color: AppTheme.textMuted),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  p.descricao,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5, color: AppTheme.textPrimary),
                ),
                const SizedBox(height: 2),
                Text(
                  'Cód ${p.codigo.isNotEmpty ? p.codigo : p.id} • ${_fmtDate(p.dtInicioProm)} → ${_fmtDate(p.dtFimProm)}',
                  style: const TextStyle(fontSize: 11.5, color: AppTheme.textMuted),
                ),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _pill(rotulo, corSituacao),
                    _pill('-${p.descontoPercentual}%', AppTheme.primary),
                    Text(_prazo(p), style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: corSituacao)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                _money.format(p.precoVenda),
                style: const TextStyle(
                  fontSize: 11,
                  color: AppTheme.textMuted,
                  decoration: TextDecoration.lineThrough,
                ),
              ),
              Text(
                _money.format(p.precoPromocao),
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: AppTheme.primary),
              ),
            ],
          ),
          const SizedBox(width: 4),
          IconButton(
            tooltip: 'Editar produto / promoção',
            icon: const Icon(Icons.edit_note, color: AppTheme.textPrimary),
            onPressed: _busy ? null : () => _editar(p),
          ),
          IconButton(
            tooltip: 'Encerrar promoção',
            icon: const Icon(Icons.highlight_off, color: AppTheme.dangerLight),
            onPressed: _busy ? null : () => _encerrar([p], titulo: 'Encerrar promoção'),
          ),
        ],
      ),
    );
  }

  Widget _pill(String texto, Color cor) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: cor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(texto, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: cor)),
    );
  }
}
