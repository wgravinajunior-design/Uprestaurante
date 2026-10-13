import 'package:flutter/material.dart';
import '../models/product.dart';
import '../models/dashboard_stats.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/product_card.dart';
import '../widgets/product_table_view.dart';
import '../widgets/product_edit_dialog.dart';
import '../widgets/audit_history_view.dart';
import '../models/promotion_item.dart';
import '../widgets/promotions_view.dart';
import '../widgets/batch_dialogs.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  // Navigation: 0 = Produtos & Promoções, 1 = Auditoria ERP
  int _currentNavIndex = 0;
  bool _isGridView = true;

  // Data & Filters
  DashboardStats? _stats;
  List<Product> _products = [];
  bool _isLoading = true;
  String? _error;

  String _searchTerm = '';
  String _selectedStatus = 'TODOS';
  String _selectedPromo = 'TODOS';
  String _selectedStock = 'TODOS';
  String _selectedSort = 'PADRAO';
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;

  final TextEditingController _searchController = TextEditingController();

  // Seleção em lote
  bool _selectionMode = false;
  final Set<int> _selected = <int>{};

  // Promoções que pedem atenção (selo no menu)
  PromotionCounts _promoCounts = const PromotionCounts();

  @override
  void initState() {
    super.initState();
    _loadInitialData();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadInitialData() async {
    await Future.wait([
      _fetchStats(),
      _fetchProducts(),
      _fetchPromoCounts(),
    ]);
  }

  Future<void> _fetchStats() async {
    try {
      final s = await ApiService.getStats();
      if (mounted) setState(() => _stats = s);
    } catch (_) {}
  }

  // Descarta respostas antigas quando o usuario troca filtro/pagina rapidamente
  int _fetchSeq = 0;

  Future<void> _fetchProducts() async {
    final seq = ++_fetchSeq;
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final res = await ApiService.getProducts(
        search: _searchTerm,
        status: _selectedStatus,
        promo: _selectedPromo,
        stock: _selectedStock,
        sort: _selectedSort,
        page: _currentPage,
        pageSize: 24,
      );

      if (mounted && seq == _fetchSeq) {
        setState(() {
          _products = res['items'];
          _currentPage = res['page'];
          _totalPages = res['totalPages'] < 1 ? 1 : res['totalPages'];
          _totalCount = res['total'];
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted && seq == _fetchSeq) {
        setState(() {
          _error = e.toString().replaceAll('Exception: ', '');
          _isLoading = false;
        });
      }
    }
  }

  void _onProductUpdated(Product updated) {
    setState(() {
      final idx = _products.indexWhere((p) => p.id == updated.id);
      if (idx != -1) {
        _products[idx] = updated;
      }
    });
    _fetchStats();
    _fetchPromoCounts();
  }

  Future<void> _fetchPromoCounts() async {
    try {
      final data = await ApiService.getPromotions();
      if (mounted) setState(() => _promoCounts = data.contagem);
    } catch (_) {}
  }

  void _onPromotionsChanged(PromotionCounts counts) {
    if (mounted) setState(() => _promoCounts = counts);
    _fetchStats();
  }

  // ---- Edição em lote ----
  void _toggleSelectMode() {
    setState(() {
      _selectionMode = !_selectionMode;
      if (!_selectionMode) _selected.clear();
    });
  }

  void _toggleSelect(int id) {
    setState(() {
      if (!_selected.add(id)) _selected.remove(id);
    });
  }

  void _selectPage() {
    setState(() => _selected.addAll(_products.map((p) => p.id)));
  }

  Future<void> _runBatch({
    required String acao,
    required String titulo,
    required String descricao,
    Map<String, dynamic> params = const {},
    bool confirmar = true,
  }) async {
    final ids = _selected.toList();
    if (ids.isEmpty) return;

    if (confirmar) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(titulo),
          content: Text('$descricao\n\nProdutos selecionados: ${ids.length}'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
            ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Aplicar')),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => const Center(child: CircularProgressIndicator(color: AppTheme.primary)),
    );

    try {
      final result = await ApiService.batchUpdate(ids: ids, acao: acao, params: params);
      if (!mounted) return;
      Navigator.pop(context); // fecha o indicador de progresso
      await showBatchResultDialog(context, result);

      // mantém selecionados apenas os que falharam
      final List res = result['resultados'] as List? ?? [];
      final falhos = res
          .where((r) => r is Map && r['ok'] != true)
          .map((r) => (r as Map)['id'])
          .whereType<num>()
          .map((n) => n.toInt())
          .toSet();
      if (!mounted) return;
      setState(() {
        _selected
          ..clear()
          ..addAll(falhos);
      });
      _fetchStats();
      _fetchProducts();
      _fetchPromoCounts();
    } catch (e) {
      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppTheme.dangerLight,
          content: Text(e.toString().replaceAll('Exception: ', '')),
        ),
      );
    }
  }

  Future<void> _batchPreco() async {
    final r = await showBatchPercentDialog(context, promo: false, count: _selected.length);
    if (r == null || !mounted) return;
    final pct = r['percentual'] as double;
    await _runBatch(
      acao: 'PRECO_PERCENTUAL',
      titulo: 'Reajustar preços',
      descricao: 'Aplicar ${pct > 0 ? '+' : ''}${pct.toStringAsFixed(pct == pct.roundToDouble() ? 0 : 2)}% sobre o preço de venda.',
      params: {'percentual': pct},
    );
  }

  Future<void> _batchPromocao() async {
    final r = await showBatchPercentDialog(context, promo: true, count: _selected.length);
    if (r == null || !mounted) return;
    final pct = r['percentual'] as double;
    await _runBatch(
      acao: 'PROMOCAO_PERCENTUAL',
      titulo: 'Colocar em promoção',
      descricao: 'Desconto de ${pct.toStringAsFixed(pct == pct.roundToDouble() ? 0 : 2)}% sobre o preço de venda'
          '${r['dtFim'] != null ? ', até ${r['dtFim']}' : ', sem data de término'}.',
      params: r,
    );
  }

  Widget _batchButton(IconData icon, String label, VoidCallback? onTap, {Color? color}) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 16, color: color),
      label: Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color)),
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        side: BorderSide(color: color ?? AppTheme.borderLight),
      ),
    );
  }

  Widget _buildBatchBar(bool isMobile) {
    final n = _selected.length;
    final has = n > 0;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7ED),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFFDBA74)),
      ),
      child: Wrap(
        spacing: 8,
        runSpacing: 6,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            n == 0 ? 'Marque os produtos' : '$n selecionado(s)',
            style: const TextStyle(fontWeight: FontWeight.w800, color: AppTheme.primary, fontSize: 13),
          ),
          TextButton(onPressed: _selectPage, child: const Text('Marcar página', style: TextStyle(fontSize: 12))),
          TextButton(
            onPressed: has ? () => setState(_selected.clear) : null,
            child: const Text('Limpar seleção', style: TextStyle(fontSize: 12)),
          ),
          _batchButton(
            Icons.check_circle_outline,
            'Ativar',
            has
                ? () => _runBatch(
                      acao: 'STATUS',
                      titulo: 'Ativar produtos',
                      descricao: 'Os produtos selecionados ficarão ATIVOS.',
                      params: {'status': 'A'},
                    )
                : null,
            color: AppTheme.successLight,
          ),
          _batchButton(
            Icons.cancel_outlined,
            'Inativar',
            has
                ? () => _runBatch(
                      acao: 'STATUS',
                      titulo: 'Inativar produtos',
                      descricao: 'Os produtos selecionados ficarão INATIVOS.',
                      params: {'status': 'I'},
                    )
                : null,
            color: AppTheme.dangerLight,
          ),
          _batchButton(Icons.price_change, 'Reajustar preço %', has ? _batchPreco : null),
          _batchButton(Icons.local_fire_department, 'Promoção %', has ? _batchPromocao : null, color: AppTheme.primary),
          _batchButton(
            Icons.highlight_off,
            'Remover promoção',
            has
                ? () => _runBatch(
                      acao: 'PROMOCAO_REMOVER',
                      titulo: 'Remover promoções',
                      descricao: 'Os produtos selecionados voltam ao preço normal.',
                    )
                : null,
          ),
        ],
      ),
    );
  }

  void _openDetails(Product product) {
    showDialog(
      context: context,
      builder: (ctx) => ProductEditDialog(
        product: product,
        onUpdated: _onProductUpdated,
      ),
    );
  }

  void _resetFilters() {
    setState(() {
      _searchTerm = '';
      _searchController.clear();
      _selectedStatus = 'TODOS';
      _selectedPromo = 'TODOS';
      _selectedStock = 'TODOS';
      _selectedSort = 'PADRAO';
      _currentPage = 1;
    });
    _fetchProducts();
  }

  void _showSettingsDialog() {
    final controller = TextEditingController(text: ApiService.baseUrl);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.settings, color: AppTheme.primary),
            SizedBox(width: 10),
            Text('Conexão com Servidor ERP'),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Endereço da API REST (Servidor Electron / Firebird 5.0):',
              style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                hintText: 'http://localhost:8080',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar', style: TextStyle(color: AppTheme.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () {
              ApiService.baseUrl = controller.text.trim();
              Navigator.pop(ctx);
              _loadInitialData();
            },
            child: const Text('Salvar'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isMobile = MediaQuery.of(context).size.width < 900;

    return Scaffold(
      key: _scaffoldKey,
      drawer: isMobile ? Drawer(child: _buildSidebar(isDrawer: true)) : null,
      appBar: isMobile
          ? AppBar(
              backgroundColor: AppTheme.surfaceWhite,
              elevation: 0,
              bottom: const PreferredSize(
                preferredSize: Size.fromHeight(1),
                child: Divider(height: 1, color: AppTheme.borderLight),
              ),
              leading: IconButton(
                icon: const Icon(Icons.menu, color: AppTheme.textPrimary),
                onPressed: () => _scaffoldKey.currentState?.openDrawer(),
              ),
              title: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(colors: [Color(0xFFFF6B00), Color(0xFFEA580C)]),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Text(
                      'DUSUCO',
                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 13, letterSpacing: 1),
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Text('ERP Produtos', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                ],
              ),
              actions: [
                IconButton(
                  icon: const Icon(Icons.refresh, color: AppTheme.textSecondary),
                  onPressed: () {
                    _fetchStats();
                    _fetchProducts();
                  },
                ),
              ],
            )
          : null,
      body: Row(
        children: [
          // Persistent Sidebar on Desktop & Tablet (width >= 900)
          if (!isMobile)
            SizedBox(
              width: 275,
              child: _buildSidebar(isDrawer: false),
            ),

          // Main Products / Audit Content Area
          Expanded(
            child: Container(
              color: AppTheme.bgLight,
              child: _currentNavIndex == 0
                  ? _buildProductsArea(isMobile)
                  : (_currentNavIndex == 1
                      ? PromotionsView(onChanged: _onPromotionsChanged)
                      : const AuditHistoryView()),
            ),
          ),
        ],
      ),
    );
  }

  // --- Light Clean Sidebar Component with DUSUCO Orange Identity ---
  Widget _buildSidebar({required bool isDrawer}) {
    return Container(
      decoration: const BoxDecoration(
        color: AppTheme.surfaceWhite,
        border: Border(right: BorderSide(color: AppTheme.borderLight)),
      ),
      child: Column(
        children: [
          // Header / Logo
          Container(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 18),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppTheme.borderLight)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        // DUSUCO Orange Gradient Badge
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Color(0xFFFF6B00), Color(0xFFEA580C)],
                            ),
                            borderRadius: BorderRadius.circular(8),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFFEA580C).withValues(alpha: 0.35),
                                blurRadius: 10,
                                offset: const Offset(0, 3),
                              ),
                            ],
                          ),
                          child: const Text(
                            'DUSUCO',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w900,
                              fontSize: 14,
                              letterSpacing: 1.5,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        const Text(
                          'Promoções & Preços',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: AppTheme.textPrimary,
                            letterSpacing: 0.2,
                          ),
                        ),
                      ],
                    ),
                    if (isDrawer)
                      IconButton(
                        icon: const Icon(Icons.close, color: AppTheme.textSecondary, size: 20),
                        onPressed: () => Navigator.pop(context),
                      ),
                  ],
                ),
              ],
            ),
          ),

          // Navigation Links
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            child: Column(
              children: [
                _buildSidebarNavItem(
                  title: 'Produtos & Promoções',
                  icon: Icons.inventory_2_outlined,
                  index: 0,
                  isDrawer: isDrawer,
                ),
                const SizedBox(height: 4),
                _buildSidebarNavItem(
                  title: 'Promoções',
                  icon: Icons.local_offer_outlined,
                  index: 1,
                  isDrawer: isDrawer,
                  badge: _promoCounts.atencao,
                ),
                const SizedBox(height: 4),
                _buildSidebarNavItem(
                  title: 'Auditoria ERP',
                  icon: Icons.manage_history,
                  index: 2,
                  isDrawer: isDrawer,
                ),
              ],
            ),
          ),

          const Divider(color: AppTheme.borderLight, height: 1),

          // Quick Filter KPI Section
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'RESUMO & FILTROS',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            color: AppTheme.textMuted,
                            letterSpacing: 0.8,
                          ),
                        ),
                        if (_selectedStatus != 'TODOS' || _selectedPromo != 'TODOS' || _selectedStock != 'TODOS')
                          InkWell(
                            onTap: _resetFilters,
                            child: const Text(
                              'Limpar',
                              style: TextStyle(fontSize: 11, color: AppTheme.primary, fontWeight: FontWeight.bold),
                            ),
                          ),
                      ],
                    ),
                  ),

                  // Total Produtos
                  _buildKpiFilterTile(
                    title: 'Total de Produtos',
                    value: _stats?.totalProdutos.toString() ?? '...',
                    icon: Icons.grid_view,
                    color: AppTheme.primary,
                    bgColor: AppTheme.primaryLighter,
                    isSelected: _selectedStatus == 'TODOS' && _selectedPromo == 'TODOS' && _selectedStock == 'TODOS',
                    onTap: () {
                      _resetFilters();
                      if (isDrawer) Navigator.pop(context);
                    },
                  ),

                  // Ativos
                  _buildKpiFilterTile(
                    title: 'Produtos Ativos',
                    value: _stats?.ativos.toString() ?? '...',
                    icon: Icons.check_circle_outline,
                    color: AppTheme.successLight,
                    bgColor: AppTheme.successBg,
                    isSelected: _selectedStatus == 'ATIVOS',
                    onTap: () {
                      setState(() {
                        _selectedStatus = 'ATIVOS';
                        _currentPage = 1;
                      });
                      _fetchProducts();
                      if (isDrawer) Navigator.pop(context);
                    },
                  ),

                  // Inativos
                  _buildKpiFilterTile(
                    title: 'Produtos Inativos',
                    value: _stats?.inativos.toString() ?? '...',
                    icon: Icons.cancel_outlined,
                    color: AppTheme.dangerLight,
                    bgColor: AppTheme.dangerBg,
                    isSelected: _selectedStatus == 'INATIVOS',
                    onTap: () {
                      setState(() {
                        _selectedStatus = 'INATIVOS';
                        _currentPage = 1;
                      });
                      _fetchProducts();
                      if (isDrawer) Navigator.pop(context);
                    },
                  ),

                  // Em Promoção
                  _buildKpiFilterTile(
                    title: 'Em Promoção',
                    value: _stats?.emPromocao.toString() ?? '...',
                    icon: Icons.local_fire_department,
                    color: AppTheme.primary,
                    bgColor: const Color(0xFFFFF7ED),
                    isSelected: _selectedPromo == 'EM_PROMOCAO',
                    onTap: () {
                      setState(() {
                        _selectedPromo = 'EM_PROMOCAO';
                        _currentPage = 1;
                      });
                      _fetchProducts();
                      if (isDrawer) Navigator.pop(context);
                    },
                  ),

                  // Estoque Baixo
                  _buildKpiFilterTile(
                    title: 'Estoque Baixo (<= 5)',
                    value: _stats?.estoqueBaixo.toString() ?? '...',
                    icon: Icons.warning_amber_rounded,
                    color: AppTheme.warningLight,
                    bgColor: AppTheme.warningBg,
                    isSelected: _selectedStock == 'BAIXO',
                    onTap: () {
                      setState(() {
                        _selectedStock = 'BAIXO';
                        // O contador considera apenas produtos ativos
                        _selectedStatus = 'ATIVOS';
                        _currentPage = 1;
                      });
                      _fetchProducts();
                      if (isDrawer) Navigator.pop(context);
                    },
                  ),
                ],
              ),
            ),
          ),

          // Bottom Server & Config Footer
          Container(
            padding: const EdgeInsets.all(14),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: AppTheme.borderLight)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      side: const BorderSide(color: AppTheme.borderLight),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    icon: const Icon(Icons.settings, size: 16, color: AppTheme.textSecondary),
                    label: const Text(
                      'Configurações',
                      style: TextStyle(fontSize: 12, color: AppTheme.textPrimary, fontWeight: FontWeight.bold),
                    ),
                    onPressed: _showSettingsDialog,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSidebarNavItem({
    required String title,
    required IconData icon,
    required int index,
    required bool isDrawer,
    int badge = 0,
  }) {
    final isSelected = _currentNavIndex == index;
    return InkWell(
      onTap: () {
        setState(() => _currentNavIndex = index);
        if (isDrawer) Navigator.pop(context);
      },
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: [
            Icon(icon, size: 20, color: isSelected ? Colors.white : AppTheme.textSecondary),
            const SizedBox(width: 12),
            Text(
              title,
              style: TextStyle(
                fontSize: 13,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
                color: isSelected ? Colors.white : AppTheme.textPrimary,
              ),
            ),
            if (badge > 0) ...[
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: isSelected ? Colors.white : AppTheme.dangerLight,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$badge',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: isSelected ? AppTheme.primary : Colors.white,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildKpiFilterTile({
    required String title,
    required String value,
    required IconData icon,
    required Color color,
    required Color bgColor,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: BoxDecoration(
            color: isSelected ? bgColor : AppTheme.surfaceWhite,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isSelected ? color : AppTheme.borderLight,
              width: isSelected ? 1.5 : 1,
            ),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: color.withValues(alpha: 0.12),
                      blurRadius: 6,
                      offset: const Offset(0, 2),
                    ),
                  ]
                : null,
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: color, size: 16),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
                    color: isSelected ? color : AppTheme.textPrimary,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  value,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: color,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // --- Main Products Area ---
  Widget _buildProductsArea(bool isMobile) {
    return Padding(
      padding: EdgeInsets.symmetric(
        horizontal: isMobile ? 12 : 24,
        vertical: isMobile ? 12 : 16,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Filter and Search Toolbar
          _buildFilterToolbar(isMobile),
          const SizedBox(height: 12),

          // Active filter indicator chip bar (if any filter is selected)
          if (_selectedStatus != 'TODOS' || _selectedPromo != 'TODOS' || _selectedStock != 'TODOS' || _searchTerm.isNotEmpty)
            _buildActiveFilterChips(),

          // Barra de ações em lote (quando o modo seleção está ligado)
          if (_selectionMode) _buildBatchBar(isMobile),

          // Product Catalog Grid or Table
          Expanded(
            child: _buildCatalogContent(isMobile),
          ),

          // Pagination Bar
          _buildPagination(isMobile),
        ],
      ),
    );
  }

  Widget _buildActiveFilterChips() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      // Wrap: evita overflow horizontal em telas estreitas com varios filtros
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        runSpacing: 4,
        children: [
          const Text('Filtros ativos: ', style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
          const SizedBox(width: 6),
          if (_searchTerm.isNotEmpty)
            _buildChip('Busca: "$_searchTerm"', () {
              setState(() {
                _searchTerm = '';
                _searchController.clear();
                _currentPage = 1;
              });
              _fetchProducts();
            }),
          if (_selectedStatus != 'TODOS')
            _buildChip(_selectedStatus == 'ATIVOS' ? 'Apenas Ativos' : 'Apenas Inativos', () {
              setState(() {
                _selectedStatus = 'TODOS';
                _currentPage = 1;
              });
              _fetchProducts();
            }),
          if (_selectedPromo != 'TODOS')
            _buildChip(_selectedPromo == 'EM_PROMOCAO' ? 'Em Promoção' : 'Preço Regular', () {
              setState(() {
                _selectedPromo = 'TODOS';
                _currentPage = 1;
              });
              _fetchProducts();
            }),
          if (_selectedStock != 'TODOS')
            _buildChip(
                _selectedStock == 'BAIXO'
                    ? 'Estoque Baixo'
                    : (_selectedStock == 'SEM_ESTOQUE' ? 'Sem Estoque' : 'Estoque Normal'), () {
              setState(() {
                _selectedStock = 'TODOS';
                _currentPage = 1;
              });
              _fetchProducts();
            }),
          if (_selectedSort != 'PADRAO')
            _buildChip('Ordenação: $_selectedSort', () {
              setState(() {
                _selectedSort = 'PADRAO';
                _currentPage = 1;
              });
              _fetchProducts();
            }),
          TextButton(
            onPressed: _resetFilters,
            child: const Text('Limpar Todos', style: TextStyle(fontSize: 12, color: AppTheme.primary, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Widget _buildChip(String label, VoidCallback onRemove) {
    return Container(
      margin: const EdgeInsets.only(right: 6),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.primaryLighter,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFFDBA74)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.primary)),
          const SizedBox(width: 4),
          InkWell(
            onTap: onRemove,
            child: const Icon(Icons.close, size: 14, color: AppTheme.primary),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterToolbar(bool isMobile) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.borderLight),
        boxShadow: const [
          BoxShadow(
            color: Color(0x06000000),
            blurRadius: 10,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: isMobile
          ? Column(
              children: [
                // Search Box
                TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Buscar produto, código ou ref...',
                    prefixIcon: const Icon(Icons.search, color: AppTheme.textSecondary, size: 20),
                    suffixIcon: _searchTerm.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear, size: 16),
                            onPressed: () {
                              _searchController.clear();
                              setState(() => _searchTerm = '');
                              _fetchProducts();
                            },
                          )
                        : null,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  ),
                  onSubmitted: (val) {
                    setState(() {
                      _searchTerm = val;
                      _currentPage = 1;
                    });
                    _fetchProducts();
                  },
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: _buildStatusDropdown()),
                    const SizedBox(width: 8),
                    Expanded(child: _buildPromoDropdown()),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: _buildStockDropdown()),
                    const SizedBox(width: 8),
                    Expanded(child: _buildSortDropdown()),
                    const SizedBox(width: 8),
                    _buildViewToggler(),
                  ],
                ),
              ],
            )
          : Row(
              children: [
                // Search Box
                Expanded(
                  flex: 3,
                  child: TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      hintText: 'Buscar por descrição, código ou referência...',
                      prefixIcon: const Icon(Icons.search, color: AppTheme.textSecondary),
                      suffixIcon: _searchTerm.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear, size: 18),
                              onPressed: () {
                                _searchController.clear();
                                setState(() => _searchTerm = '');
                                _fetchProducts();
                              },
                            )
                          : null,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    ),
                    onSubmitted: (val) {
                      setState(() {
                        _searchTerm = val;
                        _currentPage = 1;
                      });
                      _fetchProducts();
                    },
                  ),
                ),
                const SizedBox(width: 10),

                // Status Dropdown
                _buildStatusDropdown(),
                const SizedBox(width: 10),

                // Promo Dropdown
                _buildPromoDropdown(),
                const SizedBox(width: 10),

                // Stock Dropdown
                _buildStockDropdown(),
                const SizedBox(width: 10),

                // Sort Dropdown
                _buildSortDropdown(),
                const SizedBox(width: 10),

                // View Toggler (Grid vs Table)
                _buildViewToggler(),
                const SizedBox(width: 10),

                // Refresh Button
                IconButton(
                  tooltip: 'Recarregar dados do ERP',
                  icon: const Icon(Icons.refresh, color: AppTheme.textSecondary),
                  onPressed: () {
                    _fetchStats();
                    _fetchProducts();
                  },
                ),
              ],
            ),
    );
  }

  Widget _buildStatusDropdown() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: _selectedStatus,
          dropdownColor: AppTheme.surfaceWhite,
          icon: const Icon(Icons.keyboard_arrow_down, color: AppTheme.textSecondary),
          items: const [
            DropdownMenuItem(value: 'TODOS', child: Text('Status: Todos', style: TextStyle(fontSize: 12))),
            DropdownMenuItem(value: 'ATIVOS', child: Text('Status: Ativos', style: TextStyle(fontSize: 12, color: AppTheme.successLight, fontWeight: FontWeight.bold))),
            DropdownMenuItem(value: 'INATIVOS', child: Text('Status: Inativos', style: TextStyle(fontSize: 12, color: AppTheme.dangerLight, fontWeight: FontWeight.bold))),
          ],
          onChanged: (val) {
            if (val != null) {
              setState(() {
                _selectedStatus = val;
                _currentPage = 1;
              });
              _fetchProducts();
            }
          },
        ),
      ),
    );
  }

  Widget _buildPromoDropdown() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: _selectedPromo,
          dropdownColor: AppTheme.surfaceWhite,
          icon: const Icon(Icons.keyboard_arrow_down, color: AppTheme.textSecondary),
          items: const [
            DropdownMenuItem(value: 'TODOS', child: Text('Promo: Todos', style: TextStyle(fontSize: 12))),
            DropdownMenuItem(value: 'EM_PROMOCAO', child: Text('Em Promoção', style: TextStyle(fontSize: 12, color: AppTheme.primary, fontWeight: FontWeight.bold))),
            DropdownMenuItem(value: 'REGULAR', child: Text('Preço Regular', style: TextStyle(fontSize: 12))),
          ],
          onChanged: (val) {
            if (val != null) {
              setState(() {
                _selectedPromo = val;
                _currentPage = 1;
              });
              _fetchProducts();
            }
          },
        ),
      ),
    );
  }

  Widget _buildStockDropdown() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: _selectedStock,
          dropdownColor: AppTheme.surfaceWhite,
          icon: const Icon(Icons.keyboard_arrow_down, color: AppTheme.textSecondary),
          items: const [
            DropdownMenuItem(value: 'TODOS', child: Text('Estoque: Todos', style: TextStyle(fontSize: 12))),
            DropdownMenuItem(value: 'BAIXO', child: Text('Estoque Baixo (<=5)', style: TextStyle(fontSize: 12, color: AppTheme.warningLight, fontWeight: FontWeight.bold))),
            DropdownMenuItem(value: 'NORMAL', child: Text('Estoque Normal (>5)', style: TextStyle(fontSize: 12, color: AppTheme.successLight))),
            DropdownMenuItem(value: 'SEM_ESTOQUE', child: Text('Sem Estoque (<=0)', style: TextStyle(fontSize: 12, color: AppTheme.dangerLight, fontWeight: FontWeight.bold))),
          ],
          onChanged: (val) {
            if (val != null) {
              setState(() {
                _selectedStock = val;
                _currentPage = 1;
              });
              _fetchProducts();
            }
          },
        ),
      ),
    );
  }

  Widget _buildSortDropdown() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: _selectedSort,
          dropdownColor: AppTheme.surfaceWhite,
          icon: const Icon(Icons.keyboard_arrow_down, color: AppTheme.textSecondary),
          items: const [
            DropdownMenuItem(value: 'PADRAO', child: Text('Ordenar: Padrão (Fotos)', style: TextStyle(fontSize: 12))),
            DropdownMenuItem(value: 'MAIS_RECENTES', child: Text('Mais Recentes', style: TextStyle(fontSize: 12))),
            DropdownMenuItem(value: 'PRECO_ASC', child: Text('Menor Preço', style: TextStyle(fontSize: 12))),
            DropdownMenuItem(value: 'PRECO_DESC', child: Text('Maior Preço', style: TextStyle(fontSize: 12))),
            DropdownMenuItem(value: 'ESTOQUE_ASC', child: Text('Menor Estoque', style: TextStyle(fontSize: 12))),
            DropdownMenuItem(value: 'ESTOQUE_DESC', child: Text('Maior Estoque', style: TextStyle(fontSize: 12))),
            DropdownMenuItem(value: 'NOME_ASC', child: Text('Nome (A-Z)', style: TextStyle(fontSize: 12))),
            DropdownMenuItem(value: 'DESCONTO_DESC', child: Text('Maior Desconto %', style: TextStyle(fontSize: 12, color: AppTheme.primary, fontWeight: FontWeight.bold))),
          ],
          onChanged: (val) {
            if (val != null) {
              setState(() {
                _selectedSort = val;
                _currentPage = 1;
              });
              _fetchProducts();
            }
          },
        ),
      ),
    );
  }

  Widget _buildViewToggler() {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.borderLight),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: 'Visualização em Cards',
            icon: Icon(Icons.grid_view, color: _isGridView ? AppTheme.primary : AppTheme.textMuted, size: 18),
            onPressed: () => setState(() => _isGridView = true),
          ),
          IconButton(
            tooltip: 'Visualização em Tabela',
            icon: Icon(Icons.table_rows, color: !_isGridView ? AppTheme.primary : AppTheme.textMuted, size: 18),
            onPressed: () => setState(() => _isGridView = false),
          ),
          IconButton(
            tooltip: _selectionMode ? 'Sair da seleção em lote' : 'Selecionar vários (edição em lote)',
            icon: Icon(
              _selectionMode ? Icons.checklist_rtl : Icons.checklist,
              color: _selectionMode ? AppTheme.primary : AppTheme.textMuted,
              size: 18,
            ),
            onPressed: _toggleSelectMode,
          ),
        ],
      ),
    );
  }

  Widget _buildCatalogContent(bool isMobile) {
    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: AppTheme.primary),
            SizedBox(height: 14),
            Text('Carregando produtos...', style: TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off, size: 48, color: AppTheme.dangerLight),
            const SizedBox(height: 14),
            Text('Erro ao consultar banco de dados: $_error', style: const TextStyle(color: AppTheme.dangerLight)),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _fetchProducts, child: const Text('Tentar Novamente')),
          ],
        ),
      );
    }

    if (_products.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.search_off, size: 48, color: AppTheme.textMuted),
            const SizedBox(height: 14),
            const Text('Nenhum produto encontrado com os filtros selecionados.', style: TextStyle(color: AppTheme.textSecondary)),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _resetFilters, child: const Text('Limpar Filtros')),
          ],
        ),
      );
    }

    if (!_isGridView) {
      return ProductTableView(
        products: _products,
        onUpdated: _onProductUpdated,
        onOpenDetails: _openDetails,
        selectionMode: _selectionMode,
        selectedIds: _selected,
        onToggleSelect: _toggleSelect,
      );
    }

    // Fully Responsive Grid: 5 cards on PC desktop, up to 3 cards on mobile
    return LayoutBuilder(
      builder: (ctx, constraints) {
        final w = constraints.maxWidth;
        int crossAxisCount = 5;
        double childAspectRatio = 0.58;

        if (w >= 1150) {
          // PC Desktop: 5 cards per row
          crossAxisCount = 5;
          childAspectRatio = 0.56;
        } else if (w >= 900) {
          // Compact desktop / laptop: 4 cards
          crossAxisCount = 4;
          childAspectRatio = 0.56;
        } else if (w >= 650) {
          // Tablet: 3 cards
          crossAxisCount = 3;
          childAspectRatio = 0.56;
        } else if (w >= 480) {
          // Large mobile / mini tablet: 3 cards
          crossAxisCount = 3;
          childAspectRatio = 0.53;
        } else {
          // Standard mobile: 2 cards
          crossAxisCount = 2;
          childAspectRatio = 0.54;
        }

        return GridView.builder(
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: crossAxisCount,
            crossAxisSpacing: isMobile ? 8 : 12,
            mainAxisSpacing: isMobile ? 8 : 12,
            childAspectRatio: childAspectRatio,
          ),
          itemCount: _products.length,
          itemBuilder: (ctx, index) {
            final p = _products[index];
            return ProductCard(
              product: p,
              onUpdated: _onProductUpdated,
              onOpenDetails: () => _openDetails(p),
              selectionMode: _selectionMode,
              selected: _selected.contains(p.id),
              onToggleSelect: () => _toggleSelect(p.id),
            );
          },
        );
      },
    );
  }

  Widget _buildPagination(bool isMobile) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: const BoxDecoration(
        color: AppTheme.surfaceWhite,
        border: Border(top: BorderSide(color: AppTheme.borderLight)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            isMobile ? '$_totalCount produtos' : 'Exibindo ${_products.length} de $_totalCount produtos',
            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
          ),
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.chevron_left, size: 20),
                onPressed: _currentPage > 1
                    ? () {
                        setState(() => _currentPage--);
                        _fetchProducts();
                      }
                    : null,
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.primaryLighter,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFFFED7AA)),
                ),
                child: Text(
                  '$_currentPage / $_totalPages',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.primary),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.chevron_right, size: 20),
                onPressed: _currentPage < _totalPages
                    ? () {
                        setState(() => _currentPage++);
                        _fetchProducts();
                      }
                    : null,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
