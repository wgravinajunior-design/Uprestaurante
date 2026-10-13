class SalesRecord {
  final int pedido;
  final double quantidade;
  final double valorUnitario;
  final double valorTotal;
  final String dataLancamento;
  final double desconto;
  final bool foiPromocao;

  SalesRecord({
    required this.pedido,
    required this.quantidade,
    required this.valorUnitario,
    required this.valorTotal,
    required this.dataLancamento,
    this.desconto = 0,
    this.foiPromocao = false,
  });

  factory SalesRecord.fromJson(Map<String, dynamic> json) {
    return SalesRecord(
      pedido: json['pedido'] is int ? json['pedido'] : int.tryParse(json['pedido'].toString()) ?? 0,
      quantidade: (json['quantidade'] as num?)?.toDouble() ?? 0.0,
      valorUnitario: (json['valorUnitario'] as num?)?.toDouble() ?? 0.0,
      valorTotal: (json['valorTotal'] as num?)?.toDouble() ?? 0.0,
      dataLancamento: json['dataLancamento']?.toString() ?? '',
      desconto: (json['desconto'] as num?)?.toDouble() ?? 0.0,
      foiPromocao: json['foiPromocao'] == true,
    );
  }
}
