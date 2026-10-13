/// Uma promoção cadastrada em um produto (vem de GET /api/promotions).
class PromotionItem {
  final int id;
  final String codigo;
  final String descricao;
  final String status;
  final String unidade;
  final double precoVenda;
  final double precoPromocao;
  final int descontoPercentual;
  final String? dtInicioProm;
  final String? dtFimProm;

  /// ATIVA | FUTURA | VENCIDA
  final String situacao;
  final int? diasParaFim;
  final int? diasParaInicio;
  final bool expirando;
  final double estoque;
  final bool temFoto;
  final String? ultimaAlteracao;

  PromotionItem({
    required this.id,
    required this.codigo,
    required this.descricao,
    required this.status,
    required this.unidade,
    required this.precoVenda,
    required this.precoPromocao,
    required this.descontoPercentual,
    this.dtInicioProm,
    this.dtFimProm,
    required this.situacao,
    this.diasParaFim,
    this.diasParaInicio,
    required this.expirando,
    required this.estoque,
    required this.temFoto,
    this.ultimaAlteracao,
  });

  bool get isAtiva => situacao == 'ATIVA';
  bool get isFutura => situacao == 'FUTURA';
  bool get isVencida => situacao == 'VENCIDA';

  factory PromotionItem.fromJson(Map<String, dynamic> json) {
    return PromotionItem(
      id: (json['id'] as num?)?.toInt() ?? 0,
      codigo: json['codigo']?.toString() ?? '',
      descricao: json['descricao']?.toString() ?? '',
      status: json['status']?.toString() ?? 'A',
      unidade: json['unidade']?.toString() ?? 'UN',
      precoVenda: (json['precoVenda'] as num?)?.toDouble() ?? 0.0,
      precoPromocao: (json['precoPromocao'] as num?)?.toDouble() ?? 0.0,
      descontoPercentual: (json['descontoPercentual'] as num?)?.toInt() ?? 0,
      dtInicioProm: json['dtInicioProm']?.toString(),
      dtFimProm: json['dtFimProm']?.toString(),
      situacao: json['situacao']?.toString() ?? 'ATIVA',
      diasParaFim: (json['diasParaFim'] as num?)?.toInt(),
      diasParaInicio: (json['diasParaInicio'] as num?)?.toInt(),
      expirando: json['expirando'] == true,
      estoque: (json['estoque'] as num?)?.toDouble() ?? 0.0,
      temFoto: json['temFoto'] == true,
      ultimaAlteracao: json['ultimaAlteracao']?.toString(),
    );
  }
}

/// Promoção agendada para começar numa data futura (fila do servidor).
class AgendaItem {
  final String id;
  final int produtoId;
  final String codigo;
  final String descricao;
  final double precoVenda;
  final double precoPromocao;
  final int descontoPercentual;
  final String dtInicio;
  final String? dtFim;
  final int diasParaInicio;
  final String status;

  AgendaItem({
    required this.id,
    required this.produtoId,
    required this.codigo,
    required this.descricao,
    required this.precoVenda,
    required this.precoPromocao,
    required this.descontoPercentual,
    required this.dtInicio,
    this.dtFim,
    required this.diasParaInicio,
    required this.status,
  });

  factory AgendaItem.fromJson(Map<String, dynamic> json) {
    return AgendaItem(
      id: json['id']?.toString() ?? '',
      produtoId: (json['produtoId'] as num?)?.toInt() ?? 0,
      codigo: json['codigo']?.toString() ?? '',
      descricao: json['descricao']?.toString() ?? '',
      precoVenda: (json['precoVenda'] as num?)?.toDouble() ?? 0.0,
      precoPromocao: (json['precoPromocao'] as num?)?.toDouble() ?? 0.0,
      descontoPercentual: (json['descontoPercentual'] as num?)?.toInt() ?? 0,
      dtInicio: json['dtInicio']?.toString() ?? '',
      dtFim: json['dtFim']?.toString(),
      diasParaInicio: (json['diasParaInicio'] as num?)?.toInt() ?? 0,
      status: json['status']?.toString() ?? 'AGENDADA',
    );
  }
}

class PromotionCounts {
  final int todas;
  final int ativas;
  final int expirando;
  final int futuras;
  final int vencidas;
  final int agendadas;

  const PromotionCounts({
    this.todas = 0,
    this.ativas = 0,
    this.expirando = 0,
    this.futuras = 0,
    this.vencidas = 0,
    this.agendadas = 0,
  });

  /// Quantas promoções pedem atenção (vencidas ainda gravadas + prestes a expirar).
  int get atencao => vencidas + expirando;

  factory PromotionCounts.fromJson(Map<String, dynamic> json) {
    int n(String k) => (json[k] as num?)?.toInt() ?? 0;
    return PromotionCounts(
      todas: n('todas'),
      ativas: n('ativas'),
      expirando: n('expirando'),
      futuras: n('futuras'),
      vencidas: n('vencidas'),
      agendadas: n('agendadas'),
    );
  }
}

class PromotionsData {
  final PromotionCounts contagem;
  final List<PromotionItem> itens;

  /// Janela (em dias) usada para marcar uma promoção como "expirando".
  final int diasAlerta;

  PromotionsData({required this.contagem, required this.itens, this.diasAlerta = 3});

  factory PromotionsData.fromJson(Map<String, dynamic> json) {
    final List raw = json['itens'] ?? [];
    return PromotionsData(
      diasAlerta: (json['diasAlerta'] as num?)?.toInt() ?? 3,
      contagem: PromotionCounts.fromJson((json['contagem'] as Map?)?.cast<String, dynamic>() ?? {}),
      itens: raw.map((e) => PromotionItem.fromJson((e as Map).cast<String, dynamic>())).toList(),
    );
  }
}
