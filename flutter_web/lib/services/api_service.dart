import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:web/web.dart' as web;
import '../models/product.dart';
import '../models/sales_record.dart';
import '../models/audit_entry.dart';
import '../models/dashboard_stats.dart';
import '../models/promotion_item.dart';

/// Conflito ao agendar uma promoção (HTTP 409): já existe promoção no período.
class ScheduleConflict implements Exception {
  final String message;
  final String produto;
  final List<Map<String, dynamic>> conflitos;

  ScheduleConflict(this.message, this.produto, this.conflitos);

  @override
  String toString() => message;
}

/// Cliente HTTP que informa [ApiService.online]: qualquer resposta (mesmo 4xx/5xx) = servidor alcançável;
/// falha de rede/timeout = offline (a tela "servidor offline" assume e tenta reconectar).
class _TrackingClient extends http.BaseClient {
  final http.Client _inner = http.Client();

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    try {
      final response = await _inner.send(request).timeout(const Duration(seconds: 30));
      ApiService.online.value = true;
      if (response.statusCode == 401) ApiService._irParaLogin();
      return response;
    } on TimeoutException {
      ApiService.online.value = false;
      throw Exception('O servidor não respondeu a tempo');
    } catch (_) {
      ApiService.online.value = false;
      throw Exception('Sem conexão com o servidor');
    }
  }
}

class ApiService {
  /// false quando o servidor não é alcançado.
  static final ValueNotifier<bool> online = ValueNotifier<bool>(true);

  /// false quando o servidor responde mas o banco Firebird está indisponível.
  static final ValueNotifier<bool> dbOk = ValueNotifier<bool>(true);

  /// Incrementa quando a conexão volta: as telas recarregam os dados.
  static final ValueNotifier<int> reconnected = ValueNotifier<int>(0);

  static final http.Client _client = _TrackingClient();

  // Em producao o app e servido pela propria API (porta 8080): usa o mesmo host,
  // assim funciona em outros PCs da rede. Em 'flutter run' cai para o host atual:8080.
  static String baseUrl = _resolveBaseUrl();

  // Token opcional: flutter build web --dart-define=API_TOKEN=xxx (igual ao API_TOKEN do servidor)
  static const String _apiToken = String.fromEnvironment('API_TOKEN');

  static Map<String, String> get _jsonHeaders => {
        'Content-Type': 'application/json',
        if (_apiToken.isNotEmpty) 'x-api-token': _apiToken,
      };

  // Usa a mensagem de erro devolvida pela API (ex.: "Preço inválido"); senao, o texto padrao.
  static Exception _error(http.Response response, String fallback) {
    try {
      final j = jsonDecode(utf8.decode(response.bodyBytes));
      if (j is Map && j['error'] != null && j['error'].toString().isNotEmpty) {
        return Exception(j['error'].toString());
      }
    } catch (_) {}
    return Exception(fallback);
  }

  static String _resolveBaseUrl() {
    final u = Uri.base;
    final host = u.host.isNotEmpty ? u.host : 'localhost';
    // Servido pela própria API (porta 8080, ou domínio/porta padrão atrás de proxy/túnel): mesma origem.
    // Em 'flutter run' (porta aleatória) cai para host:8080.
    final marcado = web.document.querySelector('meta[name=uprestaurante-api]') != null; // injetado pelo servidor
    final servidoPelaApi = u.host.isNotEmpty && (marcado || !u.hasPort || u.port == 8080);
    return servidoPelaApi ? u.origin : 'http://$host:8080';
  }

  static bool _redirecionando = false;

  /// Sessão ausente/expirada (HTTP 401): leva à tela de login do servidor e volta para o app.
  static void _irParaLogin() {
    if (_redirecionando) return;
    final origem = Uri.tryParse(baseUrl)?.origin;
    if (origem == null || origem != Uri.base.origin) return; // API em outra origem (dev): sem redirecionar
    _redirecionando = true;
    final next = Uri.encodeComponent(web.window.location.pathname + web.window.location.search);
    web.window.location.href = '/login?next=$next';
  }

  /// [width]: largura em px (miniatura gerada no servidor). Sem ele, a imagem original.
  static String getProductImageUrl(int id, [String? cacheKey, int? width]) {
    final params = <String>[];
    if (width != null && width > 0) params.add('w=$width');
    if (cacheKey != null && cacheKey.isNotEmpty) params.add('v=${Uri.encodeComponent(cacheKey)}');
    final q = params.isEmpty ? '' : '?${params.join('&')}';
    return '$baseUrl/api/products/$id/image$q';
  }

  static Future<DashboardStats> getStats() async {
    final response = await _client.get(Uri.parse('$baseUrl/api/stats'));
    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        return DashboardStats.fromJson(json['data']);
      }
    }
    throw _error(response, 'Falha ao carregar estatísticas do servidor');
  }

  static Future<Map<String, dynamic>> getProducts({
    String search = '',
    String status = 'TODOS',
    String promo = 'TODOS',
    String stock = 'TODOS',
    String sort = 'PADRAO',
    int page = 1,
    int pageSize = 24,
  }) async {
    final queryParams = {
      'search': search,
      'status': status,
      'promo': promo,
      'stock': stock,
      'sort': sort,
      'page': page.toString(),
      'pageSize': pageSize.toString(),
    };

    final uri = Uri.parse('$baseUrl/api/products').replace(queryParameters: queryParams);
    final response = await _client.get(uri);

    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        final List itemsJson = json['data']['items'] ?? [];
        final items = itemsJson.map((item) => Product.fromJson(item)).toList();
        return {
          'total': json['data']['total'] ?? 0,
          'page': json['data']['page'] ?? 1,
          'totalPages': json['data']['totalPages'] ?? 1,
          'items': items,
        };
      }
    }
    throw _error(response, 'Falha ao carregar lista de produtos');
  }

  static Future<Product> getProduct(int id) async {
    final response = await _client.get(Uri.parse('$baseUrl/api/products/$id'));
    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        return Product.fromJson(json['data']);
      }
    }
    throw _error(response, 'Falha ao carregar dados do produto');
  }

  static Future<Product> updateStatus(int id, String status) async {
    final response = await _client.put(
      Uri.parse('$baseUrl/api/products/$id/status'),
      headers: _jsonHeaders,
      body: jsonEncode({'status': status}),
    );

    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        return Product.fromJson(json['data']);
      }
    }
    throw _error(response, 'Falha ao atualizar status do produto');
  }

  static Future<Product> updatePrice(int id, double precoVenda, [double? precoMinimo]) async {
    final response = await _client.put(
      Uri.parse('$baseUrl/api/products/$id/price'),
      headers: _jsonHeaders,
      body: jsonEncode({
        'precoVenda': precoVenda,
        ...?precoMinimo != null ? {'precoMinimo': precoMinimo} : null,
      }),
    );

    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        return Product.fromJson(json['data']);
      }
    }
    throw _error(response, 'Falha ao alterar preço do produto');
  }

  static Future<Product> updatePromotion(int id, {
    required bool ativo,
    double? valorPromocional,
    String? dtInicio,
    String? dtFim,
    String tipoValor = 'V',
  }) async {
    final response = await _client.put(
      Uri.parse('$baseUrl/api/products/$id/promotion'),
      headers: _jsonHeaders,
      body: jsonEncode({
        'ativo': ativo,
        'valorPromocional': valorPromocional,
        'dtInicio': dtInicio,
        'dtFim': dtFim,
        'tipoValor': tipoValor,
      }),
    );

    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        return Product.fromJson(json['data']);
      }
    }
    throw _error(response, 'Falha ao atualizar promoção');
  }

  static Future<Product> updateFields(int id, Map<String, dynamic> fields) async {
    final response = await _client.put(
      Uri.parse('$baseUrl/api/products/$id/fields'),
      headers: _jsonHeaders,
      body: jsonEncode(fields),
    );

    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        return Product.fromJson(json['data']);
      }
    }
    throw _error(response, 'Falha ao atualizar campos do produto');
  }

  static Future<Product> updateStock(int id, double estoque, [String? motivo]) async {
    final response = await _client.put(
      Uri.parse('$baseUrl/api/products/$id/stock'),
      headers: _jsonHeaders,
      body: jsonEncode({
        'estoque': estoque,
        ...?motivo != null ? {'motivo': motivo} : null,
      }),
    );

    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        return Product.fromJson(json['data']);
      }
    }
    throw _error(response, 'Falha ao atualizar estoque');
  }

  static Future<Product> quickEditProduct(int id, Map<String, dynamic> data) async {
    final response = await _client.put(
      Uri.parse('$baseUrl/api/products/$id/quick-edit'),
      headers: _jsonHeaders,
      body: jsonEncode(data),
    );

    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        return Product.fromJson(json['data']);
      }
    }
    throw _error(response, 'Falha na edição rápida do produto');
  }

  /// Promoções cadastradas, classificadas em ativas / expirando / futuras / vencidas.
  static Future<PromotionsData> getPromotions({String estado = 'TODAS', int dias = 3}) async {
    final uri = Uri.parse('$baseUrl/api/promotions')
        .replace(queryParameters: {'estado': estado, 'dias': dias.toString()});
    final response = await _client.get(uri);
    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        return PromotionsData.fromJson((json['data'] as Map).cast<String, dynamic>());
      }
    }
    throw _error(response, 'Falha ao carregar promoções');
  }

  /// Edição em lote. [acao]: STATUS | PRECO_PERCENTUAL | PROMOCAO_PERCENTUAL | PROMOCAO_REMOVER.
  /// Retorna { total, ok, falhas, resultados: [...] }.
  static Future<Map<String, dynamic>> batchUpdate({
    required List<int> ids,
    required String acao,
    Map<String, dynamic> params = const {},
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/products/batch'),
      headers: _jsonHeaders,
      body: jsonEncode({'ids': ids, 'acao': acao, 'params': params}),
    );
    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        return (json['data'] as Map).cast<String, dynamic>();
      }
    }
    throw _error(response, 'Falha na edição em lote');
  }

  /// Dashboard de vendas ([inicio]/[fim] = 'AAAA-MM-DD'). [comparar]: ANTERIOR | SEMANA | NENHUM.
  static Future<Map<String, dynamic>> getDashboard({
    required String inicio,
    required String fim,
    String comparar = 'ANTERIOR',
  }) async {
    final uri = Uri.parse('$baseUrl/api/dashboard')
        .replace(queryParameters: {'inicio': inicio, 'fim': fim, 'comparar': comparar});
    final response = await _client.get(uri);
    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) return (json['data'] as Map).cast<String, dynamic>();
    }
    throw _error(response, 'Falha ao carregar o dashboard');
  }

  /// Alterações do dia (preço, promoção, estoque, status...) de [data] = 'AAAA-MM-DD'.
  static Future<Map<String, dynamic>> getChanges(String data) async {
    final uri = Uri.parse('$baseUrl/api/changes').replace(queryParameters: {'data': data});
    final response = await _client.get(uri);
    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) return (json['data'] as Map).cast<String, dynamic>();
    }
    throw _error(response, 'Falha ao carregar as alterações do dia');
  }

  /// Verifica servidor + banco e atualiza [online] / [dbOk]. Usado pela tela de reconexão.
  static Future<bool> checkHealth() async {
    try {
      final response = await _client.get(Uri.parse('$baseUrl/api/health')).timeout(const Duration(seconds: 6));
      final ok = response.statusCode == 200;
      dbOk.value = ok;
      return ok;
    } catch (_) {
      // _TrackingClient já marcou online = false
      return false;
    }
  }

  /// Agenda uma promoção futura. Lança [ScheduleConflict] se houver conflito e [forcar] for false.
  static Future<Map<String, dynamic>> schedulePromotion({
    required int produtoId,
    double? percentual,
    double? precoPromocao,
    required String dtInicio,
    String? dtFim,
    bool forcar = false,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/promotions/schedule'),
      headers: _jsonHeaders,
      body: jsonEncode({
        'produtoId': produtoId,
        'percentual': ?percentual,
        'precoPromocao': ?precoPromocao,
        'dtInicio': dtInicio,
        'dtFim': ?dtFim,
        'forcar': forcar,
      }),
    );
    final json = jsonDecode(utf8.decode(response.bodyBytes));
    if (response.statusCode == 200 && json['success'] == true) {
      return (json['data'] as Map).cast<String, dynamic>();
    }
    if (response.statusCode == 409 && json is Map && json['codigo'] == 'CONFLITO') {
      final det = (json['detalhes'] as Map?) ?? {};
      final prod = (det['produto'] as Map?)?['descricao']?.toString() ?? 'Produto';
      final lista = ((det['conflitos'] as List?) ?? [])
          .map((e) => (e as Map).cast<String, dynamic>())
          .toList();
      throw ScheduleConflict(json['error']?.toString() ?? 'Conflito de promoção', prod, lista);
    }
    throw _error(response, 'Falha ao agendar promoção');
  }

  static Future<List<AgendaItem>> getAgenda() async {
    final response = await _client.get(Uri.parse('$baseUrl/api/promotions/agenda'));
    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        final List raw = json['data'] ?? [];
        return raw.map((e) => AgendaItem.fromJson((e as Map).cast<String, dynamic>())).toList();
      }
    }
    throw _error(response, 'Falha ao carregar a agenda');
  }

  static Future<void> cancelAgenda(String id) async {
    final response = await _client.delete(Uri.parse('$baseUrl/api/promotions/agenda/$id'), headers: _jsonHeaders);
    if (response.statusCode == 200) return;
    throw _error(response, 'Falha ao cancelar o agendamento');
  }

  static Future<bool> uploadImage(int id, Uint8List imageBytes, String filename) async {
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/api/products/$id/image'));
    if (_apiToken.isNotEmpty) request.headers['x-api-token'] = _apiToken;
    request.files.add(http.MultipartFile.fromBytes(
      'image',
      imageBytes,
      filename: filename,
    ));

    final streamedResponse = await _client.send(request);
    final response = await http.Response.fromStream(streamedResponse);
    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      return json['success'] == true;
    }
    return false;
  }

  static Future<List<SalesRecord>> getSalesHistory(int id) async {
    final response = await _client.get(Uri.parse('$baseUrl/api/products/$id/sales'));
    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        final List items = json['data'] ?? [];
        return items.map((item) => SalesRecord.fromJson(item)).toList();
      }
    }
    return [];
  }

  static Future<List<AuditEntry>> getAuditHistory() async {
    final response = await _client.get(Uri.parse('$baseUrl/api/audit'));
    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        final List items = json['data'] ?? [];
        return items.map((item) => AuditEntry.fromJson(item)).toList();
      }
    }
    return [];
  }
}
