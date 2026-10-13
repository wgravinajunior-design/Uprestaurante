import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import '../models/product.dart';
import '../models/sales_record.dart';
import '../models/audit_entry.dart';
import '../models/dashboard_stats.dart';
import '../models/promotion_item.dart';

class ApiService {
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
    final host = Uri.base.host.isNotEmpty ? Uri.base.host : 'localhost';
    return 'http://$host:8080';
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
    final response = await http.get(Uri.parse('$baseUrl/api/stats'));
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
    final response = await http.get(uri);

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
    final response = await http.get(Uri.parse('$baseUrl/api/products/$id'));
    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json['success'] == true) {
        return Product.fromJson(json['data']);
      }
    }
    throw _error(response, 'Falha ao carregar dados do produto');
  }

  static Future<Product> updateStatus(int id, String status) async {
    final response = await http.put(
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
    final response = await http.put(
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
    final response = await http.put(
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
    final response = await http.put(
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
    final response = await http.put(
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
    final response = await http.put(
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
    final response = await http.get(uri);
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
    final response = await http.post(
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

  static Future<bool> uploadImage(int id, Uint8List imageBytes, String filename) async {
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/api/products/$id/image'));
    if (_apiToken.isNotEmpty) request.headers['x-api-token'] = _apiToken;
    request.files.add(http.MultipartFile.fromBytes(
      'image',
      imageBytes,
      filename: filename,
    ));

    final streamedResponse = await request.send();
    final response = await http.Response.fromStream(streamedResponse);
    if (response.statusCode == 200) {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      return json['success'] == true;
    }
    return false;
  }

  static Future<List<SalesRecord>> getSalesHistory(int id) async {
    final response = await http.get(Uri.parse('$baseUrl/api/products/$id/sales'));
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
    final response = await http.get(Uri.parse('$baseUrl/api/audit'));
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
