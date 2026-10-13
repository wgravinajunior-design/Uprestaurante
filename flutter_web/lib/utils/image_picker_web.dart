import 'dart:async';
import 'dart:js_interop';
import 'dart:typed_data';
import 'package:web/web.dart' as web;

/// Imagem escolhida pelo usuário (câmera ou arquivo).
class PickedImage {
  final Uint8List bytes;
  final String name;

  PickedImage(this.bytes, this.name);
}

/// Abre o seletor de imagens do navegador.
/// Com [camera] = true, em celulares abre direto a câmera traseira (atributo `capture`);
/// no computador cai no seletor de arquivos. Retorna null se o usuário cancelar.
Future<PickedImage?> pickImage({bool camera = false}) {
  final completer = Completer<PickedImage?>();
  final input = web.document.createElement('input') as web.HTMLInputElement;
  input.type = 'file';
  input.accept = 'image/*';
  if (camera) input.setAttribute('capture', 'environment');
  input.style.display = 'none';
  web.document.body?.append(input);

  void finish(PickedImage? value) {
    if (!completer.isCompleted) completer.complete(value);
    input.remove();
  }

  void fail(Object error) {
    if (!completer.isCompleted) completer.completeError(error);
    input.remove();
  }

  // Callbacks convertidos com toJS precisam ser síncronos (sem async).
  input.addEventListener(
    'change',
    ((web.Event _) {
      final files = input.files;
      if (files == null || files.length == 0) {
        finish(null);
        return;
      }
      final file = files.item(0)!;
      file.arrayBuffer().toDart.then(
            (buffer) => finish(PickedImage(buffer.toDart.asUint8List(), file.name)),
            onError: (Object e) => fail(e),
          );
    }).toJS,
  );
  input.addEventListener('cancel', ((web.Event _) => finish(null)).toJS);

  input.click();
  return completer.future;
}
