class DashboardStats {
  final int totalProdutos;
  final int ativos;
  final int inativos;
  final int emPromocao;
  final int estoqueBaixo;
  final bool databaseConnected;
  final String databaseFile;
  final String firebirdVersion;

  DashboardStats({
    required this.totalProdutos,
    required this.ativos,
    required this.inativos,
    required this.emPromocao,
    required this.estoqueBaixo,
    required this.databaseConnected,
    required this.databaseFile,
    required this.firebirdVersion,
  });

  factory DashboardStats.fromJson(Map<String, dynamic> json) {
    return DashboardStats(
      totalProdutos: (json['totalProdutos'] as num?)?.toInt() ?? 0,
      ativos: (json['ativos'] as num?)?.toInt() ?? 0,
      inativos: (json['inativos'] as num?)?.toInt() ?? 0,
      emPromocao: (json['emPromocao'] as num?)?.toInt() ?? 0,
      estoqueBaixo: (json['estoqueBaixo'] as num?)?.toInt() ?? 0,
      databaseConnected: json['databaseConnected'] == true,
      databaseFile: json['databaseFile']?.toString() ?? 'DADOS.FDB',
      firebirdVersion: json['firebirdVersion']?.toString() ?? 'Firebird 5.0',
    );
  }
}
