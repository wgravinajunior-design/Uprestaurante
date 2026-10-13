class AuditEntry {
  final String idRegistro;
  final int sequencia;
  final String acao; // 'A', 'I', 'E'
  final String data;
  final String descricao;
  final String campo;
  final String campoDesc;
  final String valorAntigo;
  final String valorNovo;

  AuditEntry({
    required this.idRegistro,
    required this.sequencia,
    required this.acao,
    required this.data,
    required this.descricao,
    required this.campo,
    required this.campoDesc,
    required this.valorAntigo,
    required this.valorNovo,
  });

  factory AuditEntry.fromJson(Map<String, dynamic> json) {
    return AuditEntry(
      idRegistro: json['idRegistro']?.toString() ?? '',
      sequencia: json['sequencia'] is int ? json['sequencia'] : int.tryParse(json['sequencia'].toString()) ?? 0,
      acao: json['acao']?.toString() ?? 'A',
      data: json['data']?.toString() ?? '',
      descricao: json['descricao']?.toString() ?? '',
      campo: json['campo']?.toString() ?? '',
      campoDesc: json['campoDesc']?.toString() ?? '',
      valorAntigo: json['valorAntigo']?.toString() ?? '',
      valorNovo: json['valorNovo']?.toString() ?? '',
    );
  }
}
