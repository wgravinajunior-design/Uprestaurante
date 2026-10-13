class Product {
  final int id;
  final String codigo;
  final String descricao;
  final String status; // 'A' or 'I'
  final String unidade;
  final String referencia;
  final double precoVenda;
  final double precoCompra;
  final double precoMinimo;
  final double precoPromocao;
  final String? dtInicioProm;
  final String? dtFimProm;
  final String tipoValorProm;
  final bool emPromocao;
  final int descontoPercentual;
  final double estoque;
  final double estoqueNf;
  final double estoqueMinimo;
  final String observacao;
  final bool temFoto;
  final String? ultimaAlteracao;

  Product({
    required this.id,
    required this.codigo,
    required this.descricao,
    required this.status,
    required this.unidade,
    required this.referencia,
    required this.precoVenda,
    required this.precoCompra,
    required this.precoMinimo,
    required this.precoPromocao,
    this.dtInicioProm,
    this.dtFimProm,
    this.tipoValorProm = 'V',
    required this.emPromocao,
    required this.descontoPercentual,
    required this.estoque,
    this.estoqueNf = 0,
    this.estoqueMinimo = 0,
    this.observacao = '',
    required this.temFoto,
    this.ultimaAlteracao,
  });

  // 'P' (usado pelo ERP) conta como ativo, igual aos filtros/contadores do servidor
  bool get isAtivo => status == 'A' || status == 'P';

  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id'].toString()) ?? 0,
      codigo: json['codigo']?.toString() ?? '',
      descricao: json['descricao']?.toString() ?? '',
      status: json['status']?.toString() ?? 'A',
      unidade: json['unidade']?.toString() ?? 'UN',
      referencia: json['referencia']?.toString() ?? '',
      precoVenda: (json['precoVenda'] as num?)?.toDouble() ?? 0.0,
      precoCompra: (json['precoCompra'] as num?)?.toDouble() ?? 0.0,
      precoMinimo: (json['precoMinimo'] as num?)?.toDouble() ?? 0.0,
      precoPromocao: (json['precoPromocao'] as num?)?.toDouble() ?? 0.0,
      dtInicioProm: json['dtInicioProm']?.toString(),
      dtFimProm: json['dtFimProm']?.toString(),
      tipoValorProm: json['tipoValorProm']?.toString() ?? 'V',
      emPromocao: json['emPromocao'] == true,
      descontoPercentual: (json['descontoPercentual'] as num?)?.toInt() ?? 0,
      estoque: (json['estoque'] as num?)?.toDouble() ?? 0.0,
      estoqueNf: (json['estoqueNf'] as num?)?.toDouble() ?? 0.0,
      estoqueMinimo: (json['estoqueMinimo'] as num?)?.toDouble() ?? 0.0,
      observacao: json['observacao']?.toString() ?? '',
      temFoto: json['temFoto'] == true,
      ultimaAlteracao: json['ultimaAlteracao']?.toString(),
    );
  }

  Product copyWith({
    String? status,
    double? precoVenda,
    double? precoPromocao,
    bool? emPromocao,
    String? dtInicioProm,
    String? dtFimProm,
    String? descricao,
    String? unidade,
    String? referencia,
    double? estoque,
  }) {
    return Product(
      id: id,
      codigo: codigo,
      descricao: descricao ?? this.descricao,
      status: status ?? this.status,
      unidade: unidade ?? this.unidade,
      referencia: referencia ?? this.referencia,
      precoVenda: precoVenda ?? this.precoVenda,
      precoCompra: precoCompra,
      precoMinimo: precoMinimo,
      precoPromocao: precoPromocao ?? this.precoPromocao,
      dtInicioProm: dtInicioProm ?? this.dtInicioProm,
      dtFimProm: dtFimProm ?? this.dtFimProm,
      tipoValorProm: tipoValorProm,
      emPromocao: emPromocao ?? this.emPromocao,
      descontoPercentual: descontoPercentual,
      estoque: estoque ?? this.estoque,
      estoqueNf: estoqueNf,
      estoqueMinimo: estoqueMinimo,
      observacao: observacao,
      temFoto: temFoto,
      ultimaAlteracao: ultimaAlteracao,
    );
  }
}
