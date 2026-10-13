import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/product.dart';
import '../models/sales_record.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

class ProductEditDialog extends StatefulWidget {
  final Product product;
  final Function(Product updated) onUpdated;

  const ProductEditDialog({
    super.key,
    required this.product,
    required this.onUpdated,
  });

  @override
  State<ProductEditDialog> createState() => _ProductEditDialogState();
}

class _ProductEditDialogState extends State<ProductEditDialog> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  late Product _currentProduct;

  // Controllers for Tab 1 (Dados)
  late TextEditingController _descController;
  late TextEditingController _unidadeController;
  late TextEditingController _refController;
  late TextEditingController _obsController;
  late TextEditingController _priceController;
  late TextEditingController _minPriceController;

  // Controllers for Tab 2 (Promoção)
  late bool _promoAtiva;
  late TextEditingController _promoPriceController;
  late TextEditingController _promoPercentController;
  DateTime? _promoStart;
  DateTime? _promoEnd;

  // Sales History State
  List<SalesRecord> _salesHistory = [];
  bool _isLoadingSales = false;

  bool _isSaving = false;
  String? _errorMessage;

  final currencyFormat = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
  final dateFormat = DateFormat('dd/MM/yyyy');

  @override
  void initState() {
    super.initState();
    _currentProduct = widget.product;
    _tabController = TabController(length: 3, vsync: this);

    _descController = TextEditingController(text: _currentProduct.descricao);
    _unidadeController = TextEditingController(text: _currentProduct.unidade);
    _refController = TextEditingController(text: _currentProduct.referencia);
    _obsController = TextEditingController(text: _currentProduct.observacao);
    _priceController = TextEditingController(text: _currentProduct.precoVenda.toStringAsFixed(2));
    _minPriceController = TextEditingController(text: _currentProduct.precoMinimo.toStringAsFixed(2));

    _promoAtiva = _currentProduct.emPromocao;
    _promoPriceController = TextEditingController(
      text: _currentProduct.precoPromocao > 0 ? _currentProduct.precoPromocao.toStringAsFixed(2) : '',
    );
    _promoPercentController = TextEditingController(
      text: _currentProduct.descontoPercentual > 0 ? _currentProduct.descontoPercentual.toString() : '10',
    );

    if (_currentProduct.dtInicioProm != null) {
      try {
        _promoStart = DateTime.parse(_currentProduct.dtInicioProm!);
      } catch (_) {
        _promoStart = null;
      }
    }
    if (_currentProduct.dtFimProm != null) {
      try {
        _promoEnd = DateTime.parse(_currentProduct.dtFimProm!);
      } catch (_) {
        _promoEnd = null;
      }
    }

    _loadSales();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _descController.dispose();
    _unidadeController.dispose();
    _refController.dispose();
    _obsController.dispose();
    _priceController.dispose();
    _minPriceController.dispose();
    _promoPriceController.dispose();
    _promoPercentController.dispose();
    super.dispose();
  }

  Future<void> _loadSales() async {
    setState(() => _isLoadingSales = true);
    try {
      final list = await ApiService.getSalesHistory(_currentProduct.id);
      if (mounted) setState(() => _salesHistory = list);
    } catch (e) {
      // Ignorar falha silenciosa
    } finally {
      if (mounted) setState(() => _isLoadingSales = false);
    }
  }

  Future<void> _saveDadosCadastrais() async {
    setState(() {
      _isSaving = true;
      _errorMessage = null;
    });

    try {
      final newPrice = double.tryParse(_priceController.text.replaceAll(',', '.'));
      final newMinPrice = double.tryParse(_minPriceController.text.replaceAll(',', '.'));

      // Valida antes de gravar qualquer coisa
      if (newPrice == null || newPrice < 0) {
        throw Exception('Informe um preço de venda válido');
      }
      if (_descController.text.trim().isEmpty) {
        throw Exception('A descrição do produto não pode ficar vazia');
      }

      // 1. Update general fields
      var updated = await ApiService.updateFields(_currentProduct.id, {
        'descricao': _descController.text,
        'unidade': _unidadeController.text,
        'referencia': _refController.text,
        'observacao': _obsController.text,
      });

      // 2. Update price if changed
      if (newPrice != _currentProduct.precoVenda || newMinPrice != _currentProduct.precoMinimo) {
        updated = await ApiService.updatePrice(_currentProduct.id, newPrice, newMinPrice);
      }

      widget.onUpdated(updated);
      if (!mounted) return;
      setState(() => _currentProduct = updated);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: AppTheme.success,
            content: Text('Dados e preços do produto atualizados no ERP com auditoria!'),
          ),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _errorMessage = e.toString().replaceAll('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _savePromocao() async {
    setState(() {
      _isSaving = true;
      _errorMessage = null;
    });

    try {
      double? valProm;
      if (_promoAtiva) {
        valProm = double.tryParse(_promoPriceController.text.replaceAll(',', '.'));
        if (valProm == null || valProm <= 0) throw Exception('Informe um preço promocional válido');
        if (_currentProduct.precoVenda > 0 && valProm >= _currentProduct.precoVenda) {
          throw Exception('O preço promocional deve ser menor que o preço de venda');
        }
        final now = DateTime.now();
        final today = DateTime(now.year, now.month, now.day);
        if (_promoEnd != null) {
          final end = DateTime(_promoEnd!.year, _promoEnd!.month, _promoEnd!.day);
          if (end.isBefore(today)) throw Exception('A data de término da promoção já passou');
          if (_promoStart != null && end.isBefore(DateTime(_promoStart!.year, _promoStart!.month, _promoStart!.day))) {
            throw Exception('A data de término não pode ser anterior ao início');
          }
        }
      }

      final dIni = _promoStart != null ? DateFormat('yyyy-MM-dd').format(_promoStart!) : null;
      final dFim = _promoEnd != null ? DateFormat('yyyy-MM-dd').format(_promoEnd!) : null;

      final updated = await ApiService.updatePromotion(
        _currentProduct.id,
        ativo: _promoAtiva,
        valorPromocional: valProm,
        dtInicio: dIni,
        dtFim: dFim,
      );

      widget.onUpdated(updated);
      if (!mounted) return;
      setState(() => _currentProduct = updated);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: _promoAtiva ? AppTheme.warning : AppTheme.primary,
            content: Text(_promoAtiva ? 'Promoção ativada no ERP!' : 'Promoção desativada no ERP!'),
          ),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _errorMessage = e.toString().replaceAll('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      child: Container(
        width: 820,
        height: 680,
        decoration: BoxDecoration(
          color: AppTheme.surfaceDark,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Column(
          children: [
            // Top Header
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              decoration: const BoxDecoration(
                color: Color(0xFFF8FAFC),
                borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                border: Border(bottom: BorderSide(color: AppTheme.borderLight)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: AppTheme.primaryLighter,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.inventory_2, color: AppTheme.primary, size: 20),
                      ),
                      const SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(
                                '#${_currentProduct.codigo.isNotEmpty ? _currentProduct.codigo : _currentProduct.id}',
                                style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary, fontSize: 16),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: _currentProduct.isAtivo ? AppTheme.successBg : AppTheme.dangerBg,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  _currentProduct.isAtivo ? 'ATIVO' : 'INATIVO',
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                    color: _currentProduct.isAtivo ? AppTheme.successLight : AppTheme.danger,
                                  ),
                                ),
                              ),
                              if (_currentProduct.emPromocao) ...[
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: AppTheme.warningBg,
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: const Text(
                                    'EM PROMOÇÃO',
                                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.warning),
                                  ),
                                ),
                              ],
                            ],
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _currentProduct.descricao,
                            style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ],
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, color: AppTheme.textSecondary),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
            ),

            // Tab Bar
            Container(
              color: const Color(0xFFF8FAFC),
              child: TabBar(
                controller: _tabController,
                indicatorColor: AppTheme.primary,
                indicatorWeight: 3,
                labelColor: AppTheme.primary,
                unselectedLabelColor: AppTheme.textSecondary,
                tabs: const [
                  Tab(icon: Icon(Icons.edit, size: 18), text: 'Cadastro & Preços'),
                  Tab(icon: Icon(Icons.local_offer, size: 18), text: 'Promoção & Vigência'),
                  Tab(icon: Icon(Icons.timeline, size: 18), text: 'Histórico de Vendas'),
                ],
              ),
            ),

            // Tab Views
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [
                  _buildTabCadastro(),
                  _buildTabPromocao(),
                  _buildTabVendas(),
                ],
              ),
            ),

            if (_errorMessage != null)
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.dangerBg,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(_errorMessage!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildTabCadastro() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Photo Box
              Container(
                width: 140,
                height: 140,
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.borderLight),
                ),
                clipBehavior: Clip.antiAlias,
                child: _currentProduct.temFoto
                    ? Image.network(
                        ApiService.getProductImageUrl(_currentProduct.id, _currentProduct.ultimaAlteracao, 400),
                        fit: BoxFit.cover,
                        errorBuilder: (ctx, err, stack) => const Icon(Icons.inventory_2, size: 40, color: AppTheme.textMuted),
                      )
                    : const Icon(Icons.inventory_2, size: 40, color: AppTheme.textMuted),
              ),
              const SizedBox(width: 20),
              // Fields
              Expanded(
                child: Column(
                  children: [
                    TextField(
                      controller: _descController,
                      decoration: const InputDecoration(labelText: 'Descrição do Produto'),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _unidadeController,
                            decoration: const InputDecoration(labelText: 'Unidade (UN, CX, KG)'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextField(
                            controller: _refController,
                            decoration: const InputDecoration(labelText: 'Referência'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),

          // Price & Stock Row
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _priceController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'Preço de Venda (R\$)',
                    prefixText: 'R\$ ',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _minPriceController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'Preço Mínimo (R\$)',
                    prefixText: 'R\$ ',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppTheme.borderLight),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Estoque Atual', style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
                      const SizedBox(height: 2),
                      Text(
                        '${_currentProduct.estoque.toStringAsFixed(2)} ${_currentProduct.unidade}',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: _currentProduct.estoque > 0 ? AppTheme.success : AppTheme.danger,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          TextField(
            controller: _obsController,
            maxLines: 2,
            decoration: const InputDecoration(labelText: 'Observação Interna'),
          ),
          const SizedBox(height: 24),

          Align(
            alignment: Alignment.centerRight,
            child: ElevatedButton.icon(
              onPressed: _isSaving ? null : _saveDadosCadastrais,
              icon: _isSaving
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.save, size: 18),
              label: Text(_isSaving ? 'Salvando no ERP...' : 'Salvar Alterações no ERP'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTabPromocao() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.borderLight),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Ativar Promoção para este produto', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                    const SizedBox(height: 2),
                    Text(
                      'Preço Normal: ${currencyFormat.format(_currentProduct.precoVenda)}',
                      style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                    ),
                  ],
                ),
                Switch(
                  value: _promoAtiva,
                  activeThumbColor: AppTheme.warning,
                  onChanged: (val) => setState(() => _promoAtiva = val),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          if (_promoAtiva) ...[
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _promoPriceController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: 'Preço Promocional (R\$)',
                      prefixText: 'R\$ ',
                    ),
                    onChanged: (val) {
                      final p = double.tryParse(val.replaceAll(',', '.'));
                      if (p != null && _currentProduct.precoVenda > 0) {
                        final perc = ((_currentProduct.precoVenda - p) / _currentProduct.precoVenda) * 100;
                        _promoPercentController.text = perc.toStringAsFixed(0);
                      }
                    },
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: TextField(
                    controller: _promoPercentController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Percentual de Desconto %',
                      suffixText: '%',
                    ),
                    onChanged: (val) {
                      final perc = double.tryParse(val.replaceAll(',', '.'));
                      if (perc != null && _currentProduct.precoVenda > 0) {
                        final p = _currentProduct.precoVenda * (1 - (perc / 100));
                        _promoPriceController.text = p.toStringAsFixed(2);
                      }
                    },
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
                        initialDate: _promoStart ?? DateTime.now(),
                        firstDate: DateTime(2020),
                        lastDate: DateTime(2030),
                        locale: const Locale('pt', 'BR'),
                        helpText: 'Selecione a data de início',
                        cancelText: 'Cancelar',
                        confirmText: 'Confirmar',
                      );
                      if (picked != null) setState(() => _promoStart = picked);
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF8FAFC),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppTheme.borderLight),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.calendar_today, size: 16, color: AppTheme.warning),
                          const SizedBox(width: 8),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Início da Promoção', style: TextStyle(fontSize: 10, color: AppTheme.textMuted)),
                              Text(
                                _promoStart != null ? dateFormat.format(_promoStart!) : 'A partir de Hoje',
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: InkWell(
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _promoEnd ?? DateTime.now().add(const Duration(days: 15)),
                        firstDate: DateTime(2020),
                        lastDate: DateTime(2030),
                        locale: const Locale('pt', 'BR'),
                        helpText: 'Selecione a data de término',
                        cancelText: 'Cancelar',
                        confirmText: 'Confirmar',
                      );
                      if (picked != null) setState(() => _promoEnd = picked);
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF8FAFC),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppTheme.borderLight),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.event, size: 16, color: AppTheme.warning),
                          const SizedBox(width: 8),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Término da Promoção', style: TextStyle(fontSize: 10, color: AppTheme.textMuted)),
                              Text(
                                _promoEnd != null ? dateFormat.format(_promoEnd!) : 'Indeterminado',
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
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
          ],
          const SizedBox(height: 24),

          Align(
            alignment: Alignment.centerRight,
            child: ElevatedButton.icon(
              style: ElevatedButton.styleFrom(backgroundColor: _promoAtiva ? AppTheme.warning : AppTheme.primary),
              onPressed: _isSaving ? null : _savePromocao,
              icon: _isSaving
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.check, size: 18),
              label: Text(_isSaving ? 'Salvando...' : (_promoAtiva ? 'Gravar Promoção no ERP' : 'Desativar Promoção no ERP')),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTabVendas() {
    if (_isLoadingSales) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_salesHistory.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.shopping_cart_outlined, size: 48, color: AppTheme.textMuted),
            SizedBox(height: 12),
            Text('Nenhum pedido de venda registrado para este produto.', style: TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(20),
      itemCount: _salesHistory.length,
      separatorBuilder: (ctx, i) => const Divider(color: AppTheme.borderLight, height: 1),
      itemBuilder: (ctx, i) {
        final v = _salesHistory[i];
        return ListTile(
          leading: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.receipt_long, color: AppTheme.primary, size: 20),
          ),
          title: Text(
            'Pedido #${v.pedido} • ${v.dataLancamento}',
            style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary, fontSize: 13),
          ),
          subtitle: Text(
            'Qtd: ${v.quantidade.toStringAsFixed(2)}  •  Unit: ${currencyFormat.format(v.valorUnitario)}',
            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
          ),
          trailing: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                currencyFormat.format(v.valorTotal),
                style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.success, fontSize: 15),
              ),
              if (v.foiPromocao)
                const Text('Promoção', style: TextStyle(fontSize: 10, color: AppTheme.warning, fontWeight: FontWeight.bold)),
            ],
          ),
        );
      },
    );
  }
}
