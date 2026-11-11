#!/usr/bin/env python3
"""
Sobe o site do sorteio localmente para visualizar no navegador.

Uso:
    python servidor_local.py            # abre http://localhost:8000
    python servidor_local.py --porta 9000
    python servidor_local.py --rede     # libera acesso pelo celular na mesma rede Wi-Fi

Para parar: Ctrl+C (ou feche a janela).

Observação: o site continua falando com o Apps Script real (apiUrl em config.js),
então os números e reservas exibidos são os de verdade.
"""
import argparse
import functools
import http.server
import os
import socket
import sys
import threading
import webbrowser

PASTA = os.path.dirname(os.path.abspath(__file__))


class SemCache(http.server.SimpleHTTPRequestHandler):
    """Serve os arquivos sem cache, para cada edição aparecer ao recarregar a página."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("  %s\n" % (fmt % args))


def porta_livre(host, inicial):
    for porta in range(inicial, inicial + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, porta))
                return porta
            except OSError:
                continue
    sys.exit("Nenhuma porta livre entre %d e %d." % (inicial, inicial + 49))


def ip_da_rede():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))  # não envia nada, só descobre a interface de saída
            return s.getsockname()[0]
    except OSError:
        return None


def main():
    ap = argparse.ArgumentParser(description="Servidor local do sorteio")
    ap.add_argument("--porta", type=int, default=8000, help="porta inicial (padrão 8000)")
    ap.add_argument("--rede", action="store_true", help="aceitar conexões de outros aparelhos da rede")
    ap.add_argument("--sem-navegador", action="store_true", help="não abrir o navegador automaticamente")
    args = ap.parse_args()

    host = "0.0.0.0" if args.rede else "127.0.0.1"
    porta = porta_livre(host, args.porta)
    handler = functools.partial(SemCache, directory=PASTA)
    servidor = http.server.ThreadingHTTPServer((host, porta), handler)

    base = "http://localhost:%d" % porta
    print()
    print("  Site do sorteio rodando localmente")
    print("  Site:   %s/" % base)
    print("  Admin:  %s/admin_panel.html" % base)
    if args.rede:
        ip = ip_da_rede()
        if ip:
            print("  Celular (mesma rede): http://%s:%d/" % (ip, porta))
    print("  Ctrl+C para parar.\n")

    if not args.sem_navegador:
        threading.Timer(0.6, lambda: webbrowser.open(base + "/")).start()

    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\n  Servidor encerrado.")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
