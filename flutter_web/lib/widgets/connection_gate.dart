import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// Cobre o app com uma tela de "servidor offline" quando a API (ou o banco) deixa de responder,
/// tenta reconectar sozinha e avisa o app (via [ApiService.reconnected]) para recarregar os dados.
class ConnectionGate extends StatefulWidget {
  final Widget child;

  const ConnectionGate({super.key, required this.child});

  @override
  State<ConnectionGate> createState() => _ConnectionGateState();
}

class _ConnectionGateState extends State<ConnectionGate> {
  static const int _intervalo = 5; // segundos entre tentativas

  Timer? _timer;
  int _restante = _intervalo;
  bool _verificando = false;
  int _tentativas = 0;
  bool _estavaOffline = false;

  bool get _offline => !ApiService.online.value || !ApiService.dbOk.value;

  @override
  void initState() {
    super.initState();
    ApiService.online.addListener(_mudou);
    ApiService.dbOk.addListener(_mudou);
  }

  @override
  void dispose() {
    ApiService.online.removeListener(_mudou);
    ApiService.dbOk.removeListener(_mudou);
    _timer?.cancel();
    super.dispose();
  }

  void _mudou() {
    if (!mounted) return;
    if (_offline) {
      _estavaOffline = true;
      _iniciarContagem();
    } else {
      _timer?.cancel();
      _timer = null;
      _tentativas = 0;
      _restante = _intervalo;
      if (_estavaOffline) {
        _estavaOffline = false;
        ApiService.reconnected.value++; // pede para as telas recarregarem
      }
    }
    setState(() {});
  }

  void _iniciarContagem() {
    _timer ??= Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || _verificando) return;
      if (_restante > 1) {
        setState(() => _restante--);
      } else {
        _tentarAgora();
      }
    });
  }

  Future<void> _tentarAgora() async {
    if (_verificando) return;
    setState(() {
      _verificando = true;
      _tentativas++;
    });
    await ApiService.checkHealth(); // atualiza online / dbOk (e dispara _mudou se voltou)
    if (!mounted) return;
    setState(() {
      _verificando = false;
      _restante = _intervalo;
    });
  }

  @override
  Widget build(BuildContext context) {
    final offline = _offline;
    final bancoFora = ApiService.online.value && !ApiService.dbOk.value;

    return Stack(
      children: [
        widget.child,
        if (offline)
          Positioned.fill(
            child: Material(
              color: const Color(0xE60F172A),
              child: Center(
                child: Container(
                  constraints: const BoxConstraints(maxWidth: 440),
                  margin: const EdgeInsets.all(20),
                  padding: const EdgeInsets.all(26),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: const [BoxShadow(color: Color(0x55000000), blurRadius: 30)],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        bancoFora ? Icons.storage_rounded : Icons.cloud_off_rounded,
                        size: 54,
                        color: AppTheme.dangerLight,
                      ),
                      const SizedBox(height: 14),
                      Text(
                        bancoFora ? 'Banco de dados indisponível' : 'Servidor offline',
                        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppTheme.textPrimary),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        bancoFora
                            ? 'O servidor está no ar, mas não consegue abrir o banco Firebird. Verifique se o serviço do Firebird está ativo.'
                            : 'Não foi possível falar com o servidor (${ApiService.baseUrl}). Confira se o sistema está ligado e se este aparelho está na mesma rede.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary, height: 1.4),
                      ),
                      const SizedBox(height: 18),
                      if (_verificando)
                        const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primary)),
                            SizedBox(width: 10),
                            Text('Verificando conexão…', style: TextStyle(fontWeight: FontWeight.w600)),
                          ],
                        )
                      else
                        Text(
                          'Nova tentativa em $_restante s${_tentativas > 0 ? '  •  tentativa ${_tentativas + 1}' : ''}',
                          style: const TextStyle(fontWeight: FontWeight.w600, color: AppTheme.textSecondary),
                        ),
                      const SizedBox(height: 16),
                      ElevatedButton.icon(
                        onPressed: _verificando ? null : _tentarAgora,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Tentar agora'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
