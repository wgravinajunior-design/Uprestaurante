import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'screens/home_screen.dart';
import 'theme/app_theme.dart';
import 'widgets/connection_gate.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DusucoErpApp());
}

class DusucoErpApp extends StatelessWidget {
  const DusucoErpApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DUSUCO ERP - Promoções, Preços & Estoque',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      locale: const Locale('pt', 'BR'),
      supportedLocales: const [
        Locale('pt', 'BR'),
      ],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) => ConnectionGate(child: child ?? const SizedBox.shrink()),
      home: const HomeScreen(),
    );
  }
}
