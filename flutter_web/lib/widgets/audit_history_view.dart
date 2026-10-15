import 'package:flutter/material.dart';
import '../models/audit_entry.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'feedback_widgets.dart';

class AuditHistoryView extends StatefulWidget {
  const AuditHistoryView({super.key});

  @override
  State<AuditHistoryView> createState() => _AuditHistoryViewState();
}

class _AuditHistoryViewState extends State<AuditHistoryView> {
  List<AuditEntry> _logs = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final data = await ApiService.getAuditHistory();
      if (mounted) setState(() => _logs = data);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const SkeletonList();
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 44, color: AppTheme.dangerLight),
            const SizedBox(height: 12),
            Text('Erro ao carregar auditoria: $_error', style: const TextStyle(color: AppTheme.dangerLight)),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _fetch, child: const Text('Tentar Novamente')),
          ],
        ),
      );
    }

    if (_logs.isEmpty) {
      return const Center(
        child: Text('Nenhum registro de auditoria encontrado.', style: TextStyle(color: AppTheme.textSecondary)),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Row(
              children: [
                Icon(Icons.history_edu, color: AppTheme.primary, size: 24),
                SizedBox(width: 10),
                Text(
                  'Trilha Oficial de Auditoria do ERP (TB_AUDITORIA)',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                ),
              ],
            ),
            IconButton(
              icon: const Icon(Icons.refresh, color: AppTheme.textSecondary),
              onPressed: _fetch,
              tooltip: 'Atualizar Auditoria',
            ),
          ],
        ),
        const SizedBox(height: 16),
        Expanded(
          child: Container(
            decoration: BoxDecoration(
              color: AppTheme.surfaceWhite,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.borderLight),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x06000000),
                  blurRadius: 10,
                  offset: Offset(0, 3),
                ),
              ],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: ListView.separated(
                itemCount: _logs.length,
                separatorBuilder: (ctx, i) => const Divider(color: AppTheme.borderLight, height: 1),
                itemBuilder: (ctx, i) {
                  final item = _logs[i];
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        // Seq badge
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: AppTheme.primaryLighter,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: const Color(0xFFFED7AA)),
                          ),
                          child: Text(
                            '#${item.sequencia}',
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.primary),
                          ),
                        ),
                        const SizedBox(width: 16),
                        // Product & description
                        Expanded(
                          flex: 3,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item.descricao.isNotEmpty ? item.descricao : 'Produto #${item.idRegistro}',
                                style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary, fontSize: 13),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${item.data} • Prod ID: ${item.idRegistro}',
                                style: const TextStyle(color: AppTheme.textMuted, fontSize: 11),
                              ),
                            ],
                          ),
                        ),
                        // Field changed
                        Expanded(
                          flex: 2,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item.campoDesc.isNotEmpty ? item.campoDesc : item.campo,
                                style: const TextStyle(fontWeight: FontWeight.w600, color: AppTheme.textSecondary, fontSize: 12),
                              ),
                              Text(
                                item.campo,
                                style: const TextStyle(color: AppTheme.textMuted, fontSize: 10),
                              ),
                            ],
                          ),
                        ),
                        // Values (Old -> New)
                        Expanded(
                          flex: 3,
                          child: Row(
                            children: [
                              Expanded(
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: AppTheme.dangerBg,
                                    borderRadius: BorderRadius.circular(6),
                                    border: Border.all(color: const Color(0xFFFECACA)),
                                  ),
                                  child: Text(
                                    item.valorAntigo.isNotEmpty ? item.valorAntigo : '[Vazio]',
                                    style: const TextStyle(fontSize: 11, color: AppTheme.dangerLight),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ),
                              const Padding(
                                padding: EdgeInsets.symmetric(horizontal: 6),
                                child: Icon(Icons.arrow_forward, size: 14, color: AppTheme.textMuted),
                              ),
                              Expanded(
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: AppTheme.successBg,
                                    borderRadius: BorderRadius.circular(6),
                                    border: Border.all(color: const Color(0xFFA7F3D0)),
                                  ),
                                  child: Text(
                                    item.valorNovo.isNotEmpty ? item.valorNovo : '[Vazio]',
                                    style: const TextStyle(fontSize: 11, color: AppTheme.successLight, fontWeight: FontWeight.bold),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ),
        ),
      ],
    );
  }
}
